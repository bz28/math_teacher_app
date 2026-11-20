"""File uploads travel as base64 JSON, so the global 10 MB body cap used to
reject any PDF over ~7.5 MB before the 25 MB PDF check ran. Upload routes
now get a larger cap; every other route keeps the global one."""

import re

import pytest
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.testclient import TestClient

from api.config import settings
from api.core.constants import MAX_PDF_BYTES, MAX_SUBMISSION_TOTAL_BYTES, MAX_UPLOAD_REQUEST_BYTES
from api.main import app
from api.middleware.security import UPLOAD_ROUTES, RequestSizeLimitMiddleware

UPLOAD_PATHS = {
    "/v1/teacher/courses/{course_id}/documents",
    "/v1/teacher/courses/{course_id}/question-bank/upload",
    "/v1/school/student/homework/{assignment_id}/submit",
    "/v1/school/student/homework/page-orientation",
    "/v1/school/student/submissions/{submission_id}/retake",
}


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "3f0e6c1a-0000-4000-8000-000000000000", path)


def test_upload_routes_exist_and_are_the_only_ones_matched():
    # The OpenAPI schema lists every mounted route with its full prefix.
    post_paths = {p for p, ops in app.openapi()["paths"].items() if "post" in ops}
    assert UPLOAD_PATHS <= post_paths, UPLOAD_PATHS - post_paths
    matched = {p for p in post_paths if UPLOAD_ROUTES.match(_concrete(p))}
    assert matched == UPLOAD_PATHS


def test_cap_fits_a_full_submission_and_a_25mb_pdf_once_base64():
    def b64_len(n: int) -> int:
        return 4 * ((n + 2) // 3)

    assert MAX_UPLOAD_REQUEST_BYTES > b64_len(MAX_SUBMISSION_TOTAL_BYTES)
    assert MAX_UPLOAD_REQUEST_BYTES > b64_len(MAX_PDF_BYTES)
    # The global cap is what used to reject them.
    assert b64_len(MAX_PDF_BYTES) > settings.max_request_size


def _client(max_size: int, upload_max: int) -> TestClient:
    # A bare ASGI app (no error middleware of its own) that reads the body,
    # like a FastAPI route does.
    async def inner(scope, receive, send):
        body = await Request(scope, receive).body()
        await JSONResponse({"n": len(body)})(scope, receive, send)

    return TestClient(
        RequestSizeLimitMiddleware(inner, max_size=max_size, upload_max_size=upload_max)
    )


@pytest.mark.parametrize("chunked", [False, True])
def test_upload_route_gets_the_upload_cap(chunked):
    c = _client(max_size=100, upload_max=1000)
    body = b"x" * 500
    data = iter([body]) if chunked else body
    r = c.post(_concrete("/v1/teacher/courses/{c}/documents"), content=data)
    assert r.status_code == 200, r.text
    r = c.post(_concrete("/v1/teacher/courses/{c}/documents"), content=b"x" * 1500)
    assert r.status_code == 413


@pytest.mark.parametrize("chunked", [False, True])
def test_other_routes_keep_the_global_cap(chunked):
    c = _client(max_size=100, upload_max=1000)
    body = b"x" * 500
    data = iter([body]) if chunked else body
    for path in ("/v1/auth/login", "/v1/teacher/courses/abc/documents/def",
                 "/v1/teacher/courses/abc/documents/extra"):
        assert c.post(path, content=data if not chunked else iter([body])).status_code == 413, path
    # Same path, wrong method: no upload cap.
    assert c.put(_concrete("/v1/teacher/courses/{c}/documents"), content=body).status_code == 413
