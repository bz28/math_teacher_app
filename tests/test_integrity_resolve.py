"""The teacher's resolve action on an integrity check (api/routes/
integrity_resolve.py): records who/when and the outcome, never touches
the AI's disposition or the grade."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient

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
