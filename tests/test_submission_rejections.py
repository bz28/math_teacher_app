"""A rejected homework upload leaves a row behind.

Before this, a refused upload wrote nothing: the size cap rejected the
request before any handler ran, and the handler's own refusals raised
and rolled back. A student blocked eleven times looked exactly like one
who never opened the assignment. Now every refusal — from the middleware
or the handler — lands a `submission.rejected` row in the activity log,
attributed to the student whenever the bearer token names one.
"""

from __future__ import annotations

import base64
import io
import uuid
from typing import Any

from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select

from api.core.auth import create_access_token
from api.core.submission_rejections import note_transport_rejection
from api.database import get_session_factory
from api.middleware.security import RequestSizeLimitMiddleware
from api.models.activity_log import ActivityLog
from tests.conftest import PAGE_PNG, auth_headers

_JPEG_HEADER = b"\xff\xd8\xff\xe0\x00\x10JFIF"


def _png(size: tuple[int, int]) -> str:
    buf = io.BytesIO()
    Image.new("L", size, 255).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


# A real image under the reader's MIN_PAGE_LONG_EDGE floor.
TINY_PNG = _png((40, 30))


async def _rejections() -> list[ActivityLog]:
    async with get_session_factory()() as s:
        return list((await s.execute(
            select(ActivityLog)
            .where(ActivityLog.action == "submission.rejected")
            .order_by(ActivityLog.performed_at.asc())
        )).scalars().all())


# ── Handler path ────────────────────────────────────────────────────

async def test_invalid_file_is_recorded_against_the_student(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    before = len(await _rejections())
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=auth_headers(world["student_token"]),
        json={"files": [base64.b64encode(b"not an image at all").decode()]},
    )
    assert r.status_code == 400

    rows = await _rejections()
    assert len(rows) == before + 1
    row = rows[-1]
    assert row.actor_user_id == world["student_id"]
    assert row.actor_role == "student"
    assert row.target_type == "assignment"
    assert row.target_id == world["assignment_id"]
    meta = row.action_metadata or {}
    assert meta["reason"] == "file_invalid"
    assert meta["is_preview"] is False
    # Both sizes are on the row: what the client sent, and how much of
    # it decoded before the refusal.
    assert meta["request_bytes"] == int(r.request.headers["content-length"])
    assert meta["decoded_bytes"] == 0
    assert meta["detail"].startswith("File 1:")


async def test_oversized_file_is_recorded_with_its_own_reason(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    oversized = base64.b64encode(_JPEG_HEADER + b"\x00" * (6 * 1024 * 1024)).decode()
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=auth_headers(world["student_token"]),
        json={"files": [PAGE_PNG, oversized]},
    )
    assert r.status_code == 400

    row = (await _rejections())[-1]
    meta = row.action_metadata or {}
    assert meta["reason"] == "file_too_large"
    # The first file had already decoded when the second was refused.
    assert meta["decoded_bytes"] == len(base64.b64decode(PAGE_PNG))
    assert "File 2" in meta["detail"]


async def test_a_successful_submit_records_no_rejection(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    before = len(await _rejections())
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=auth_headers(world["student_token"]),
        json={"files": [PAGE_PNG]},
    )
    assert r.status_code == 200, r.text
    assert len(await _rejections()) == before


async def test_a_page_too_small_to_read_is_recorded(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The reader's size floor refuses a page before anything is stored —
    the commonest way a phone photo gets turned away."""
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=auth_headers(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    assert r.status_code == 400
    meta = (await _rejections())[-1].action_metadata or {}
    assert meta["reason"] == "page_too_small"
    assert "too small to read" in meta["detail"]


async def test_a_refused_retake_is_recorded_against_its_homework(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A retake of flagged photos is a turn-in too: refusing it is a
    student blocked, recorded against the homework the submission is for."""
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=auth_headers(world["student_token"]),
        json={"files": [PAGE_PNG]},
    )
    assert r.status_code == 200, r.text
    sid = r.json()["submission_id"]
    r = await client.post(
        f"/v1/school/student/submissions/{sid}/flag-extraction",
        headers=auth_headers(world["student_token"]), json={"note": "sideways"},
    )
    assert r.status_code == 200, r.text
    before = len(await _rejections())
    r = await client.post(
        f"/v1/school/student/submissions/{sid}/retake",
        headers=auth_headers(world["student_token"]), json={"files": [TINY_PNG]},
    )
    assert r.status_code == 400
    rows = (await _rejections())[before:]
    assert len(rows) == 1
    assert rows[0].target_id == world["assignment_id"]
    assert (rows[0].action_metadata or {})["reason"] == "page_too_small"

    # The middleware path resolves the retake's homework the same way.
    await note_transport_rejection(
        _scope(f"/v1/school/student/submissions/{sid}/retake", token=world["student_token"]),
        90_000_000,
    )
    row = (await _rejections())[-1]
    assert row.target_id == world["assignment_id"]
    assert row.actor_user_id == world["student_id"]


# ── Middleware path ─────────────────────────────────────────────────

def _scope(
    path: str, *, method: str = "POST", token: str | None = None,
    content_length: int | None = None,
) -> dict[str, Any]:
    headers: list[tuple[bytes, bytes]] = []
    if token is not None:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    if content_length is not None:
        headers.append((b"content-length", str(content_length).encode()))
    return {
        "type": "http", "method": method, "path": path,
        "headers": headers, "client": ("203.0.113.9", 5555),
    }


async def test_transport_rejection_names_the_student_from_the_bearer(
    world: dict[str, Any],
) -> None:
    """The 413 happens before authentication, so the student is read
    off the token — the one place the request still says who it is."""
    before = len(await _rejections())
    await note_transport_rejection(
        _scope(
            f"/v1/school/student/homework/{world['assignment_id']}/submit",
            token=world["student_token"], content_length=11_600_000,
        ),
        11_600_000,
    )
    rows = await _rejections()
    assert len(rows) == before + 1
    row = rows[-1]
    assert row.actor_user_id == world["student_id"]
    assert row.target_id == world["assignment_id"]
    assert row.ip_address == "203.0.113.9"
    meta = row.action_metadata or {}
    assert meta["reason"] == "upload_too_large"
    assert meta["request_bytes"] == 11_600_000
    assert meta["decoded_bytes"] is None
    assert meta["is_preview"] is False


async def test_transport_rejection_records_only_a_signed_in_student(
    world: dict[str, Any],
) -> None:
    """Anyone can send a bare oversized header: with no student token
    the route would refuse them anyway, so nothing is written — a refusal
    must not let an anonymous caller fill the log (or a school's blocked
    list) and hold a database connection per request."""
    path = f"/v1/school/student/homework/{world['assignment_id']}/submit"
    before = len(await _rejections())
    await note_transport_rejection(_scope(path), 12_000_000)
    await note_transport_rejection(_scope(path, token="not-a-jwt"), 12_000_000)
    await note_transport_rejection(_scope(path, token=world["teacher_token"]), 12_000_000)
    assert len(await _rejections()) == before


async def test_a_retake_of_someone_elses_submission_is_not_recorded(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=auth_headers(world["student_token"]),
        json={"files": [PAGE_PNG]},
    )
    sid = r.json()["submission_id"]
    before = len(await _rejections())
    await note_transport_rejection(
        _scope(
            f"/v1/school/student/submissions/{sid}/retake",
            token=create_access_token(str(world["outsider_id"]), "student"),
        ),
        90_000_000,
    )
    assert len(await _rejections()) == before


async def test_transport_rejection_ignores_every_other_route(
    world: dict[str, Any],
) -> None:
    before = len(await _rejections())
    hw = world["assignment_id"]
    for scope in (
        _scope("/v1/school/teacher/documents", token=world["teacher_token"]),
        _scope(f"/v1/school/student/homework/{hw}/submit", method="GET"),
        _scope(f"/v1/school/student/homework/{hw}/confirm-extraction"),
        _scope("/v1/school/student/homework/page-orientation"),
        _scope("/v1/school/student/homework/not-a-uuid/submit"),
    ):
        await note_transport_rejection(scope, 12_000_000)
    assert len(await _rejections()) == before


async def test_size_limit_middleware_calls_the_hook_on_both_rejection_paths() -> None:
    """Declared Content-Length and an undeclared chunked body both
    refuse the request, and both tell the hook. A hook that raises must
    not change the client's 413."""
    seen: list[tuple[str, int]] = []

    async def hook(scope: dict[str, Any], size: int) -> None:
        seen.append((scope["path"], size))
        raise RuntimeError("the hook is best-effort")

    async def inner_app(scope: Any, receive: Any, send: Any) -> None:
        # Drain the body so the counting receive wrapper runs.
        while True:
            msg = await receive()
            if not msg.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    mw = RequestSizeLimitMiddleware(inner_app, max_size=10, on_reject=hook)

    async def run(scope: dict[str, Any], body: bytes) -> int:
        sent: list[dict[str, Any]] = []
        chunks = [body]

        async def receive() -> dict[str, Any]:
            return {"type": "http.request", "body": chunks.pop(0) if chunks else b"", "more_body": False}

        async def send(message: dict[str, Any]) -> None:
            sent.append(message)

        await mw(scope, receive, send)
        return next(m["status"] for m in sent if m["type"] == "http.response.start")

    assert await run(_scope("/declared", content_length=50), b"x" * 50) == 413
    assert await run(_scope("/chunked"), b"x" * 50) == 413
    assert await run(_scope("/fine", content_length=5), b"x" * 5) == 200
    assert seen == [("/declared", 50), ("/chunked", 50)]


async def test_an_expired_token_401_is_not_a_rejection() -> None:
    """Past the base cap, an upload route refuses a token that doesn't
    verify with a 401 so the client refreshes and retries. The student
    isn't blocked — the hook must not hear about it."""
    import re

    seen: list[int] = []

    async def hook(scope: dict[str, Any], size: int) -> None:
        seen.append(size)

    async def inner_app(scope: Any, receive: Any, send: Any) -> None:
        raise AssertionError("the body is refused before the app")

    mw = RequestSizeLimitMiddleware(
        inner_app, max_size=10, upload_caps=[(re.compile("^/up$"), 1000)], on_reject=hook,
    )
    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"x" * 50, "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    await mw(_scope("/up", token="not-a-jwt", content_length=50), receive, send)
    assert next(m["status"] for m in sent if m["type"] == "http.response.start") == 401
    assert seen == []


async def test_preview_student_rejection_is_flagged(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A teacher rehearsing as a preview student can be blocked too; the
    row is kept but flagged so it never counts as a real child."""
    from api.models.user import User
    async with get_session_factory()() as s:
        preview = User(
            email=f"preview_{uuid.uuid4().hex[:6]}@t.com", password_hash="x",
            grade_level=8, role="student", name="Preview", is_preview=True,
        )
        s.add(preview)
        await s.commit()
        preview_id = preview.id
    await note_transport_rejection(
        _scope(
            f"/v1/school/student/homework/{world['assignment_id']}/submit",
            token=create_access_token(str(preview_id), "student"),
        ),
        12_000_000,
    )
    row = (await _rejections())[-1]
    assert row.actor_user_id == preview_id
    assert (row.action_metadata or {})["is_preview"] is True
