"""File uploads travel as base64 JSON, so the global 10 MB body cap used to
reject any PDF over ~7.5 MB before the PDF size check ran. Upload routes now
get larger caps, but only for signed-in requests (FastAPI buffers the whole
body before auth runs); every other request keeps the global cap."""

import re
import uuid

import httpx
import pytest
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.testclient import TestClient

from api.config import settings
from api.core.auth import create_access_token
from api.core.constants import (
    MAX_PDF_BYTES,
    MAX_SINGLE_UPLOAD_REQUEST_BYTES,
    MAX_SUBMISSION_REQUEST_BYTES,
    MAX_SUBMISSION_TOTAL_BYTES,
)
from api.core.document_vision import MAX_TOTAL_SOURCE_B64_BYTES
from api.main import app
from api.middleware.security import (
    UPLOAD_DOCUMENT,
    UPLOAD_SUBMISSION,
    UPLOAD_WORKSHEET,
    RequestSizeLimitMiddleware,
)

UPLOAD_PATHS = {
    "/v1/teacher/courses/{course_id}/documents",
    "/v1/teacher/courses/{course_id}/question-bank/upload",
    "/v1/school/student/homework/{assignment_id}/submit",
    "/v1/school/student/homework/page-orientation",
    "/v1/school/student/submissions/{submission_id}/retake",
}
ANY_ID = "3f0e6c1a-0000-4000-8000-000000000000"


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", ANY_ID, path)


def _b64_len(n: int) -> int:
    return 4 * ((n + 2) // 3)


def _token() -> str:
    return create_access_token(str(uuid.uuid4()), "teacher")


def test_upload_routes_exist_and_are_the_only_ones_matched():
    # The OpenAPI schema lists every mounted route with its full prefix.
    post_paths = {p for p, ops in app.openapi()["paths"].items() if "post" in ops}
    assert UPLOAD_PATHS <= post_paths, UPLOAD_PATHS - post_paths
    patterns = (UPLOAD_DOCUMENT, UPLOAD_WORKSHEET, UPLOAD_SUBMISSION)
    matched = {p for p in post_paths if any(r.match(_concrete(p)) for r in patterns)}
    assert matched == UPLOAD_PATHS


def test_caps_fit_what_each_route_accepts():
    # The global cap is what used to reject a large PDF.
    assert _b64_len(MAX_PDF_BYTES) > settings.max_request_size
    assert MAX_SINGLE_UPLOAD_REQUEST_BYTES > _b64_len(MAX_PDF_BYTES)
    assert MAX_SUBMISSION_REQUEST_BYTES > _b64_len(MAX_SUBMISSION_TOTAL_BYTES)


def test_largest_pdf_fits_one_model_request():
    """A PDF is sent to the model whole when it can't be rendered page by
    page, and materials are sent as-is. A PDF the upload accepts must
    therefore fit one request, or it's stored and silently never used."""
    assert _b64_len(MAX_PDF_BYTES) <= MAX_TOTAL_SOURCE_B64_BYTES


def _client(max_size: int, upload_max: int) -> TestClient:
    # A bare ASGI app (no error middleware of its own) that reads the body,
    # like a FastAPI route does.
    async def inner(scope, receive, send):
        body = await Request(scope, receive).body()
        await JSONResponse({"n": len(body)})(scope, receive, send)

    caps = [(UPLOAD_DOCUMENT, upload_max), (UPLOAD_SUBMISSION, upload_max)]
    return TestClient(RequestSizeLimitMiddleware(inner, max_size=max_size, upload_caps=caps))


DOC = _concrete("/v1/teacher/courses/{c}/documents")


@pytest.mark.parametrize("chunked", [False, True])
def test_signed_in_upload_gets_the_upload_cap(chunked):
    c = _client(max_size=100, upload_max=1000)
    auth = {"Authorization": f"Bearer {_token()}"}
    body = b"x" * 500
    r = c.post(DOC, content=iter([body]) if chunked else body, headers=auth)
    assert r.status_code == 200, r.text
    assert c.post(DOC, content=b"x" * 1500, headers=auth).status_code == 413


@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": f"Basic {_token()}"}],
    ids=["anonymous", "not-bearer"],
)
def test_unauthenticated_upload_keeps_the_global_cap(headers):
    c = _client(max_size=100, upload_max=1000)
    assert c.post(DOC, content=b"x" * 500, headers=headers).status_code == 413


def _expired_token() -> str:
    from datetime import UTC, datetime, timedelta

    from jose import jwt

    exp = datetime.now(UTC) - timedelta(minutes=1)
    return jwt.encode({"sub": str(uuid.uuid4()), "role": "student", "exp": exp},
                      settings.jwt_secret, algorithm="HS256")


@pytest.mark.parametrize("token", [_expired_token(), "not-a-jwt"], ids=["expired", "garbage"])
@pytest.mark.parametrize("chunked", [False, True])
def test_large_upload_with_a_stale_token_gets_401_so_clients_refresh(token, chunked):
    """A student whose 15-minute token lapsed while she worked on paper
    must get the 401 that makes web and mobile refresh and retry, not a
    413 calling her in-limits file too large."""
    c = _client(max_size=100, upload_max=1000)
    body = b"x" * 500
    r = c.post(DOC, content=iter([body]) if chunked else body,
               headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid or expired token"
    # Under the global cap, the body goes through and the route decides.
    small = c.post(DOC, content=b"x" * 50, headers={"Authorization": f"Bearer {token}"})
    assert small.status_code == 200


@pytest.mark.parametrize("chunked", [False, True])
def test_other_routes_keep_the_global_cap(chunked):
    c = _client(max_size=100, upload_max=1000)
    auth = {"Authorization": f"Bearer {_token()}"}
    body = b"x" * 500
    for path in ("/v1/auth/login", "/v1/teacher/courses/abc/documents/def",
                 "/v1/teacher/courses/abc/documents/extra"):
        data = iter([body]) if chunked else body
        assert c.post(path, content=data, headers=auth).status_code == 413, path
    # Same path, wrong method: no upload cap.
    assert c.put(DOC, content=body, headers=auth).status_code == 413


async def test_real_app_lets_a_signed_in_12mb_upload_through():
    """Through the app as configured in api/middleware/setup.py, so the
    wiring itself is covered: a 12 MB PDF (over the old 10 MB cap) reaches
    the route when signed in, and is refused at the door when not."""
    pdf = "J" * _b64_len(12 * 1024 * 1024)
    body = {"file_base64": pdf, "filename": "scan.pdf", "unit_id": ANY_ID}
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        anon = await c.post(DOC, json=body)
        assert anon.status_code == 413
        signed = await c.post(DOC, json=body, headers={"Authorization": f"Bearer {_token()}"})
        # Past the size gate: the route itself answers (the user and course
        # don't exist, so it refuses on its own terms).
        assert signed.status_code != 413, signed.text
