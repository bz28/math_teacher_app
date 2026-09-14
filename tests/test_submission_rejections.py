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
import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from api.core.auth import create_access_token
from api.core.submission_rejections import note_transport_rejection
from api.database import get_session_factory
from api.middleware.security import RequestSizeLimitMiddleware
from api.models.activity_log import ActivityLog
from tests.conftest import TINY_PNG, auth_headers

_JPEG_HEADER = b"\xff\xd8\xff\xe0\x00\x10JFIF"


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
        json={"files": [TINY_PNG, oversized]},
    )
    assert r.status_code == 400

    row = (await _rejections())[-1]
    meta = row.action_metadata or {}
    assert meta["reason"] == "file_too_large"
    # The first file had already decoded when the second was refused.
    assert meta["decoded_bytes"] == len(base64.b64decode(TINY_PNG))
    assert "File 2" in meta["detail"]


async def test_a_successful_submit_records_no_rejection(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    before = len(await _rejections())
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=auth_headers(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    assert r.status_code == 200, r.text
    assert len(await _rejections()) == before


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


async def test_transport_rejection_without_a_usable_token_is_unattributed(
    world: dict[str, Any],
) -> None:
    path = f"/v1/school/student/homework/{world['assignment_id']}/submit"
    before = len(await _rejections())
    await note_transport_rejection(_scope(path), 12_000_000)
    await note_transport_rejection(_scope(path, token="not-a-jwt"), 12_000_000)
    rows = (await _rejections())[before:]
    assert len(rows) == 2
    assert all(r.actor_user_id is None for r in rows)
    assert all(r.target_id == world["assignment_id"] for r in rows)
    # No actor means no preview lookup — the key is absent, not false,
    # so a reader can't mistake "unknown" for "a real child".
    assert all("is_preview" not in (r.action_metadata or {}) for r in rows)


async def test_transport_rejection_ignores_every_other_route(
    world: dict[str, Any],
) -> None:
    before = len(await _rejections())
    hw = world["assignment_id"]
    for scope in (
        _scope("/v1/school/teacher/documents", token=world["teacher_token"]),
        _scope(f"/v1/school/student/homework/{hw}/submit", method="GET"),
        _scope(f"/v1/school/student/homework/{hw}/confirm-extraction"),
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
