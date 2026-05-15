"""Integration tests for /v1/admin/leads + meetings + notes.

Covers the operator-facing lead-management surface: list/create/
update/delete leads, schedule/edit/cancel meetings, and add/edit/
delete notes. Verifies the derived list fields (next_meeting_at,
last_touch_at) since that's the part most likely to break silently.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.contact_lead import ContactLead
from api.models.lead_meeting import LeadMeeting
from api.models.lead_note import LeadNote
from api.models.user import User
from tests.conftest import auth_headers


async def _wipe() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE lead_notes, lead_meetings, contact_leads, users "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()


@pytest.fixture
async def seeded() -> dict[str, Any]:
    """Two leads: one inbound, one warm-intro, plus an admin token."""
    await _wipe()
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=99,
            role="admin",
            name="Admin",
        )
        student = User(
            email=f"student_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=8,
            role="student",
            name="Student",
        )
        s.add_all([admin, student])
        await s.flush()

        inbound = ContactLead(
            school_name="Lincoln High",
            contact_name="Sarah Chen",
            contact_email="sarah@lincoln.edu",
            role="teacher",
            source="inbound_form",
            message="Hi, we'd love a demo",
            status="new",
        )
        warm = ContactLead(
            school_name="Roosevelt MS",
            contact_name="Tom Park",
            contact_email="tom@roosevelt.edu",
            role="admin",
            source="warm_intro",
            referred_by="Joe Smith",
            status="contacted",
        )
        s.add_all([inbound, warm])
        await s.commit()

        return {
            "admin_token": create_access_token(str(admin.id), "admin"),
            "student_token": create_access_token(str(student.id), "student"),
            "inbound_id": str(inbound.id),
            "warm_id": str(warm.id),
        }


# ── List ─────────────────────────────────────────────────────────────────────


async def test_list_leads_includes_source_and_referred_by(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    res = await client.get("/v1/admin/leads", headers=auth_headers(seeded["admin_token"]))
    assert res.status_code == 200
    leads = res.json()["leads"]
    assert len(leads) == 2

    by_id = {lead["id"]: lead for lead in leads}
    inbound = by_id[seeded["inbound_id"]]
    warm = by_id[seeded["warm_id"]]

    assert inbound["source"] == "inbound_form"
    assert inbound["referred_by"] is None
    assert inbound["message"] == "Hi, we'd love a demo"

    assert warm["source"] == "warm_intro"
    assert warm["referred_by"] == "Joe Smith"


async def test_list_leads_next_action_picks_earliest_unresolved(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    """next_meeting_at should be the earliest non-cancelled, non-held."""
    lead_id = uuid.UUID(seeded["warm_id"])
    now = datetime.now(UTC)
    async with get_session_factory()() as s:
        # A held meeting (excluded), an upcoming far meeting, an
        # upcoming near meeting (should win), and a cancelled meeting.
        s.add_all([
            LeadMeeting(
                lead_id=lead_id, type="demo",
                scheduled_at=now - timedelta(days=2),
                held_at=now - timedelta(days=2),
            ),
            LeadMeeting(
                lead_id=lead_id, type="follow_up",
                scheduled_at=now + timedelta(days=10),
            ),
            LeadMeeting(
                lead_id=lead_id, type="onboarding",
                scheduled_at=now + timedelta(days=3),
            ),
            LeadMeeting(
                lead_id=lead_id, type="other",
                scheduled_at=now + timedelta(days=1),
                cancelled_at=now,
            ),
        ])
        await s.commit()

    res = await client.get("/v1/admin/leads", headers=auth_headers(seeded["admin_token"]))
    warm = next(lead for lead in res.json()["leads"] if lead["id"] == seeded["warm_id"])
    assert warm["next_meeting_type"] == "onboarding"
    # The "near" meeting is 3 days out; round-trip via isoformat.
    assert warm["next_meeting_at"] is not None


async def test_list_leads_last_touch_prefers_recent_note_over_creation(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    """A note explicitly stamped after lead.created_at should win.

    Both timestamps come from server clocks if left to defaults, so we
    pin the note an hour ahead to avoid the same-microsecond tie that
    leaves max() at the mercy of insertion order.
    """
    lead_id = uuid.UUID(seeded["inbound_id"])
    async with get_session_factory()() as s:
        s.add(LeadNote(
            lead_id=lead_id,
            body="recent note",
            created_by_name="Admin",
            created_at=datetime.now(UTC) + timedelta(hours=1),
        ))
        await s.commit()

    res = await client.get("/v1/admin/leads", headers=auth_headers(seeded["admin_token"]))
    inbound = next(lead for lead in res.json()["leads"] if lead["id"] == seeded["inbound_id"])
    assert inbound["last_touch_kind"] == "note"


async def test_list_leads_past_unmarked_still_counts_as_next_action(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    """A scheduled meeting that's in the past with no held_at is still
    surfaced as next_action — it's the operator's prompt to mark it."""
    lead_id = uuid.UUID(seeded["warm_id"])
    async with get_session_factory()() as s:
        s.add(LeadMeeting(
            lead_id=lead_id, type="demo",
            scheduled_at=datetime.now(UTC) - timedelta(days=1),
        ))
        await s.commit()

    res = await client.get("/v1/admin/leads", headers=auth_headers(seeded["admin_token"]))
    warm = next(lead for lead in res.json()["leads"] if lead["id"] == seeded["warm_id"])
    assert warm["next_meeting_type"] == "demo"


# ── Create ───────────────────────────────────────────────────────────────────


async def test_create_lead_warm_intro_with_initial_note(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    res = await client.post(
        "/v1/admin/leads",
        headers=auth_headers(seeded["admin_token"]),
        json={
            "school_name": "Jefferson Academy",
            "contact_name": "Kim Lee",
            "contact_email": "Kim@JEFFERSON.edu",
            "role": "teacher",
            "source": "warm_intro",
            "referred_by": "  Bob Marley  ",
            "approx_students": 200,
            "initial_note": "  Bob says she wants admin features  ",
        },
    )
    assert res.status_code == 200
    new_id = res.json()["id"]

    detail = (await client.get(
        f"/v1/admin/leads/{new_id}",
        headers=auth_headers(seeded["admin_token"]),
    )).json()
    assert detail["source"] == "warm_intro"
    assert detail["referred_by"] == "Bob Marley"
    assert detail["contact_email"] == "kim@jefferson.edu"
    assert len(detail["notes"]) == 1
    assert detail["notes"][0]["body"] == "Bob says she wants admin features"


async def test_create_lead_rejects_invalid_source(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    res = await client.post(
        "/v1/admin/leads",
        headers=auth_headers(seeded["admin_token"]),
        json={
            "school_name": "X",
            "contact_name": "X",
            "contact_email": "x@x.com",
            "source": "linkedin",
        },
    )
    assert res.status_code == 400


# ── Update ───────────────────────────────────────────────────────────────────


async def test_update_lead_status_and_referred_by(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    res = await client.patch(
        f"/v1/admin/leads/{seeded['inbound_id']}",
        headers=auth_headers(seeded["admin_token"]),
        json={"status": "engaged", "referred_by": "Late add"},
    )
    assert res.status_code == 200

    detail = (await client.get(
        f"/v1/admin/leads/{seeded['inbound_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )).json()
    assert detail["status"] == "engaged"
    assert detail["referred_by"] == "Late add"


async def test_update_lead_rejects_invalid_status(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    res = await client.patch(
        f"/v1/admin/leads/{seeded['inbound_id']}",
        headers=auth_headers(seeded["admin_token"]),
        json={"status": "demo_scheduled"},
    )
    assert res.status_code == 400


async def test_update_lead_clears_referred_by_with_null(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    res = await client.patch(
        f"/v1/admin/leads/{seeded['warm_id']}",
        headers=auth_headers(seeded["admin_token"]),
        json={"referred_by": None},
    )
    assert res.status_code == 200
    detail = (await client.get(
        f"/v1/admin/leads/{seeded['warm_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )).json()
    assert detail["referred_by"] is None


# ── Delete ───────────────────────────────────────────────────────────────────


async def test_delete_lead_cascades_meetings_and_notes(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    lead_id = uuid.UUID(seeded["inbound_id"])
    async with get_session_factory()() as s:
        s.add(LeadMeeting(lead_id=lead_id, type="demo", scheduled_at=datetime.now(UTC)))
        s.add(LeadNote(lead_id=lead_id, body="bye"))
        await s.commit()

    res = await client.delete(
        f"/v1/admin/leads/{seeded['inbound_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert res.status_code == 200

    async with get_session_factory()() as s:
        remaining_m = (await s.execute(
            text("SELECT count(*) FROM lead_meetings WHERE lead_id = :id"),
            {"id": lead_id},
        )).scalar()
        remaining_n = (await s.execute(
            text("SELECT count(*) FROM lead_notes WHERE lead_id = :id"),
            {"id": lead_id},
        )).scalar()
        assert remaining_m == 0
        assert remaining_n == 0


# ── Meetings ─────────────────────────────────────────────────────────────────


async def test_create_meeting_with_held_at_logs_past_demo(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    """Logging a meeting after the fact: providing held_at + outcome at
    creation time skips the schedule-then-mark-held two-step."""
    past = (datetime.now(UTC) - timedelta(days=3)).isoformat()
    res = await client.post(
        f"/v1/admin/leads/{seeded['warm_id']}/meetings",
        headers=auth_headers(seeded["admin_token"]),
        json={
            "type": "demo",
            "scheduled_at": past,
            "held_at": past,
            "outcome": "She loved the bank workshop view",
        },
    )
    assert res.status_code == 200

    detail = (await client.get(
        f"/v1/admin/leads/{seeded['warm_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )).json()
    assert len(detail["meetings"]) == 1
    assert detail["meetings"][0]["held_at"] is not None
    assert detail["meetings"][0]["outcome"] == "She loved the bank workshop view"


async def test_mark_meeting_held(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    create = await client.post(
        f"/v1/admin/leads/{seeded['warm_id']}/meetings",
        headers=auth_headers(seeded["admin_token"]),
        json={"type": "demo", "scheduled_at": datetime.now(UTC).isoformat()},
    )
    meeting_id = create.json()["id"]

    res = await client.patch(
        f"/v1/admin/leads/{seeded['warm_id']}/meetings/{meeting_id}",
        headers=auth_headers(seeded["admin_token"]),
        json={
            "held_at": datetime.now(UTC).isoformat(),
            "outcome": "Great call",
        },
    )
    assert res.status_code == 200

    detail = (await client.get(
        f"/v1/admin/leads/{seeded['warm_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )).json()
    assert detail["meetings"][0]["held_at"] is not None
    assert detail["meetings"][0]["outcome"] == "Great call"


async def test_cancel_meeting_excludes_it_from_next_action(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    create = await client.post(
        f"/v1/admin/leads/{seeded['warm_id']}/meetings",
        headers=auth_headers(seeded["admin_token"]),
        json={
            "type": "demo",
            "scheduled_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        },
    )
    meeting_id = create.json()["id"]
    await client.patch(
        f"/v1/admin/leads/{seeded['warm_id']}/meetings/{meeting_id}",
        headers=auth_headers(seeded["admin_token"]),
        json={"cancelled_at": datetime.now(UTC).isoformat()},
    )

    res = await client.get("/v1/admin/leads", headers=auth_headers(seeded["admin_token"]))
    warm = next(lead for lead in res.json()["leads"] if lead["id"] == seeded["warm_id"])
    assert warm["next_meeting_at"] is None


async def test_create_meeting_rejects_invalid_type(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    res = await client.post(
        f"/v1/admin/leads/{seeded['warm_id']}/meetings",
        headers=auth_headers(seeded["admin_token"]),
        json={"type": "coffee", "scheduled_at": datetime.now(UTC).isoformat()},
    )
    assert res.status_code == 400


async def test_delete_meeting(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    create = await client.post(
        f"/v1/admin/leads/{seeded['warm_id']}/meetings",
        headers=auth_headers(seeded["admin_token"]),
        json={"type": "demo", "scheduled_at": datetime.now(UTC).isoformat()},
    )
    meeting_id = create.json()["id"]

    res = await client.delete(
        f"/v1/admin/leads/{seeded['warm_id']}/meetings/{meeting_id}",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert res.status_code == 200

    detail = (await client.get(
        f"/v1/admin/leads/{seeded['warm_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )).json()
    assert detail["meetings"] == []


# ── Notes ────────────────────────────────────────────────────────────────────


async def test_note_crud_roundtrip(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    create = await client.post(
        f"/v1/admin/leads/{seeded['inbound_id']}/notes",
        headers=auth_headers(seeded["admin_token"]),
        json={"body": "pricing concern"},
    )
    assert create.status_code == 200
    note_id = create.json()["id"]

    update = await client.patch(
        f"/v1/admin/leads/{seeded['inbound_id']}/notes/{note_id}",
        headers=auth_headers(seeded["admin_token"]),
        json={"body": "pricing concern — resolved"},
    )
    assert update.status_code == 200

    detail = (await client.get(
        f"/v1/admin/leads/{seeded['inbound_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )).json()
    assert detail["notes"][0]["body"] == "pricing concern — resolved"
    assert detail["notes"][0]["updated_at"] is not None

    delete = await client.delete(
        f"/v1/admin/leads/{seeded['inbound_id']}/notes/{note_id}",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert delete.status_code == 200


async def test_note_rejects_empty_body(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    res = await client.post(
        f"/v1/admin/leads/{seeded['inbound_id']}/notes",
        headers=auth_headers(seeded["admin_token"]),
        json={"body": ""},
    )
    assert res.status_code == 422  # pydantic min_length


# ── Auth ─────────────────────────────────────────────────────────────────────


async def test_non_admin_forbidden(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    res = await client.get(
        "/v1/admin/leads", headers=auth_headers(seeded["student_token"]),
    )
    assert res.status_code == 403


async def test_get_lead_404(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    res = await client.get(
        f"/v1/admin/leads/{uuid.uuid4()}",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert res.status_code == 404
