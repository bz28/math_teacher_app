"""The teacher's resolve action on an integrity check (api/routes/
integrity_resolve.py): records who/when and the outcome, never touches
the AI's disposition or the grade."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import SubmissionGrade
from api.models.integrity_check import IntegrityCheckSubmission
from tests.conftest import auth_headers as _auth
from tests.conftest import make_text, set_agent_script
from tests.test_integrity_check import _submit


async def test_teacher_resolve_records_outcome_and_is_idempotent(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The session-level resolution endpoint records who/when and the
    chosen outcome on the integrity check, surfaces it on the detail
    payload, and is idempotent — re-resolving overwrites the outcome and
    re-stamps the resolver. The AI disposition is never touched."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    # Default state: unresolved, no resolver recorded.
    detail = (await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )).json()
    assert detail["resolution"] == "unresolved"
    assert detail["resolved_by_name"] is None
    assert detail["resolved_at"] is None

    # Teacher resolves it.
    r = await client.post(
        f"/v1/teacher/integrity/submissions/{submission_id}/resolve",
        headers=_auth(world["teacher_token"]),
        json={"resolution": "contacted"},
    )
    assert r.status_code == 204, r.text

    detail2 = (await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )).json()
    assert detail2["resolution"] == "contacted"
    assert detail2["resolved_by_name"]  # resolver name/email present
    assert detail2["resolved_at"] is not None

    # Idempotent: re-resolving with a new outcome overwrites it.
    r = await client.post(
        f"/v1/teacher/integrity/submissions/{submission_id}/resolve",
        headers=_auth(world["teacher_token"]),
        json={"resolution": "cleared"},
    )
    assert r.status_code == 204, r.text
    detail3 = (await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )).json()
    assert detail3["resolution"] == "cleared"

    # Invalid outcome is rejected by the request schema.
    r = await client.post(
        f"/v1/teacher/integrity/submissions/{submission_id}/resolve",
        headers=_auth(world["teacher_token"]),
        json={"resolution": "unresolved"},
    )
    assert r.status_code == 422


async def test_teacher_undo_puts_back_exactly_what_the_resolve_replaced(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Undo restores the state before the latest resolve: from a fresh
    check, unresolved with no resolver; after a Change, the earlier
    outcome WITH its original who/when (not re-stamped). One level only:
    a second undo is a 409. Resolving and undoing never touch the AI
    disposition or the grade's approval/publish state."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]
    url = f"/v1/teacher/integrity/submissions/{submission_id}"
    headers = _auth(world["teacher_token"])

    async def detail() -> dict[str, Any]:
        return (await client.get(url, headers=headers)).json()

    async def grade_state() -> tuple[Any, Any]:
        async with get_session_factory()() as s:
            g = (await s.execute(select(SubmissionGrade).where(
                SubmissionGrade.submission_id == uuid.UUID(submission_id)))).scalar_one_or_none()
            return (g.reviewed_at, g.grade_published_at) if g else (None, None)

    async def resolve(outcome: str) -> None:
        r = await client.post(f"{url}/resolve", headers=headers, json={"resolution": outcome})
        assert r.status_code == 204, r.text

    before = await detail()
    grade_before = await grade_state()

    # Nothing to undo yet.
    assert (await client.post(f"{url}/resolve/undo", headers=headers)).status_code == 409

    # Fresh check → resolve → undo: back to unresolved, no resolver.
    await resolve("confirmed_concern")
    r = await client.post(f"{url}/resolve/undo", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"resolution": "unresolved"}
    after = await detail()
    assert after["resolution"] == "unresolved"
    assert after["resolved_by_name"] is None
    assert after["resolved_at"] is None
    # One level only.
    assert (await client.post(f"{url}/resolve/undo", headers=headers)).status_code == 409

    # Resolved last week (say, by a co-teacher) → Change → undo: the old
    # outcome comes back with its original timestamp, not "now".
    await resolve("contacted")
    async with get_session_factory()() as s:
        check = (await s.execute(select(IntegrityCheckSubmission).where(
            IntegrityCheckSubmission.submission_id == uuid.UUID(submission_id)))).scalar_one()
        old_at = datetime(2026, 11, 19, 15, 0, tzinfo=UTC)
        check.resolved_at = old_at
        await s.commit()
    await resolve("cleared")
    r = await client.post(f"{url}/resolve/undo", headers=headers)
    assert r.json() == {"resolution": "contacted"}
    restored = await detail()
    assert restored["resolution"] == "contacted"
    assert datetime.fromisoformat(restored["resolved_at"]) == old_at

    assert restored["disposition"] == before["disposition"]
    assert await grade_state() == grade_before
