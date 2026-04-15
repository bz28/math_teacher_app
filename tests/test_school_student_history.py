"""Tests for the school-student Learn history endpoints.

Two endpoints under test:
- GET /v1/school/student/history
- GET /v1/school/student/history/{consumption_id}

The list endpoint groups a student's Learn-mode consumptions by
course → homework, sorted by most recent served_at. Practice rows
are deliberately excluded.

The detail endpoint returns everything the review page needs to
render a past Learn attempt (variation, anchor, HW breadcrumb).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient

from api.database import get_session_factory
from api.models.question_bank import BankConsumption
from tests.conftest import auth_headers as _auth


async def _seed_consumption(
    *,
    student_id: uuid.UUID,
    bank_item_id: uuid.UUID,
    anchor_bank_item_id: uuid.UUID,
    assignment_id: uuid.UUID,
    context: str,
    served_at: datetime | None = None,
    completed_at: datetime | None = None,
) -> uuid.UUID:
    """Insert a BankConsumption row directly — bypasses the served-via-
    next-variation path so we can seed past Learn attempts without
    consuming the approved-sibling pool."""
    async with get_session_factory()() as s:
        row = BankConsumption(
            student_id=student_id,
            bank_item_id=bank_item_id,
            anchor_bank_item_id=anchor_bank_item_id,
            assignment_id=assignment_id,
            context=context,
        )
        if served_at is not None:
            row.served_at = served_at
        if completed_at is not None:
            row.completed_at = completed_at
        s.add(row)
        await s.commit()
        await s.refresh(row)
        return row.id


async def test_history_empty_for_student_with_no_learn_rows(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await client.get(
        "/v1/school/student/history",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    assert r.json() == {"courses": []}


async def test_history_returns_completed_learn_row(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    cid = await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][0],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="learn",
        completed_at=datetime.now(UTC),
    )

    r = await client.get(
        "/v1/school/student/history",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["courses"]) == 1
    course = body["courses"][0]
    assert course["course_name"] == "Algebra 1"
    assert len(course["homeworks"]) == 1
    hw = course["homeworks"][0]
    assert hw["assignment_title"] == "HW 1"
    assert len(hw["items"]) == 1
    item = hw["items"][0]
    assert item["consumption_id"] == str(cid)
    assert item["status"] == "completed"
    assert item["anchor_position"] == 1


async def test_history_surfaces_in_progress_learn_row(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """In-progress Learn attempts (completed_at IS NULL) must appear
    alongside completed ones — the plan explicitly includes both."""
    cid = await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][0],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="learn",
    )

    r = await client.get(
        "/v1/school/student/history",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    item = r.json()["courses"][0]["homeworks"][0]["items"][0]
    assert item["consumption_id"] == str(cid)
    assert item["status"] == "in_progress"
    assert item["completed_at"] is None


async def test_history_excludes_practice_rows(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Practice attempts are disposable drills; per the plan they're
    not surfaced in history."""
    await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][0],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="practice",
        completed_at=datetime.now(UTC),
    )
    r = await client.get(
        "/v1/school/student/history",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    assert r.json() == {"courses": []}


async def test_history_only_own_rows(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A student's history must never leak another student's rows —
    the outsider has no enrollment and should see empty."""
    await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][0],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="learn",
        completed_at=datetime.now(UTC),
    )
    r = await client.get(
        "/v1/school/student/history",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 200
    assert r.json() == {"courses": []}


async def test_history_groups_and_sorts_by_recency(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Rows within a homework are ordered by served_at desc — newest
    Learn attempt first."""
    now = datetime.now(UTC)
    older = await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][0],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="learn",
        served_at=now - timedelta(hours=2),
        completed_at=now - timedelta(hours=2),
    )
    newer = await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][1],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="learn",
        served_at=now,
        completed_at=now,
    )

    r = await client.get(
        "/v1/school/student/history",
        headers=_auth(world["student_token"]),
    )
    items = r.json()["courses"][0]["homeworks"][0]["items"]
    assert [i["consumption_id"] for i in items] == [str(newer), str(older)]


async def test_history_respects_course_filter(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][0],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="learn",
        completed_at=datetime.now(UTC),
    )

    # Non-matching course → empty result.
    r = await client.get(
        f"/v1/school/student/history?course_id={uuid.uuid4()}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    assert r.json() == {"courses": []}


async def test_history_detail_happy_path(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    cid = await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][0],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="learn",
        completed_at=datetime.now(UTC),
    )
    r = await client.get(
        f"/v1/school/student/history/{cid}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["consumption_id"] == str(cid)
    assert body["assignment_title"] == "HW 1"
    assert body["course_name"] == "Algebra 1"
    assert body["anchor_position"] == 1
    assert body["anchor_bank_item_id"] == str(world["primary_id"])
    assert body["status"] == "completed"
    # Variation payload mirrors the next-variation shape so the detail
    # page can render via the same StepTimeline component.
    assert body["variation"]["bank_item_id"] == str(
        world["approved_sibling_ids"][0],
    )
    assert body["variation"]["final_answer"] == "x = 3 or x = 4"


async def test_history_detail_404_for_outsider(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    cid = await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][0],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="learn",
        completed_at=datetime.now(UTC),
    )
    r = await client.get(
        f"/v1/school/student/history/{cid}",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 404


async def test_history_detail_404_for_practice_row(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Practice rows aren't addressable via the history detail route.
    404 (not 403) so we don't leak that practice rows exist."""
    cid = await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][0],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="practice",
        completed_at=datetime.now(UTC),
    )
    r = await client.get(
        f"/v1/school/student/history/{cid}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404


async def test_history_detail_404_for_nonexistent(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await client.get(
        f"/v1/school/student/history/{uuid.uuid4()}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404


async def test_history_detail_surfaces_in_progress(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    cid = await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][0],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="learn",
    )
    r = await client.get(
        f"/v1/school/student/history/{cid}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "in_progress"
    assert body["completed_at"] is None


async def test_history_detail_404_after_dropping_enrollment(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A student who dropped the course loses access to past Learn
    attempts — the detail endpoint must re-check enrollment, not just
    ownership of the consumption row."""
    from sqlalchemy import text

    cid = await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][0],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="learn",
        completed_at=datetime.now(UTC),
    )

    # Sanity: with the enrollment intact, the detail is reachable.
    pre = await client.get(
        f"/v1/school/student/history/{cid}",
        headers=_auth(world["student_token"]),
    )
    assert pre.status_code == 200

    # Drop the student's enrollment and re-verify.
    async with get_session_factory()() as s:
        await s.execute(
            text("DELETE FROM section_enrollments WHERE student_id = :sid"),
            {"sid": world["student_id"]},
        )
        await s.commit()

    post = await client.get(
        f"/v1/school/student/history/{cid}",
        headers=_auth(world["student_token"]),
    )
    assert post.status_code == 404


async def test_history_list_hides_rows_after_dropping_enrollment(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Parity with the detail endpoint — the list already gates on
    enrollment via EXISTS; this test pins that behavior in place."""
    from sqlalchemy import text

    await _seed_consumption(
        student_id=world["student_id"],
        bank_item_id=world["approved_sibling_ids"][0],
        anchor_bank_item_id=world["primary_id"],
        assignment_id=world["assignment_id"],
        context="learn",
        completed_at=datetime.now(UTC),
    )
    async with get_session_factory()() as s:
        await s.execute(
            text("DELETE FROM section_enrollments WHERE student_id = :sid"),
            {"sid": world["student_id"]},
        )
        await s.commit()

    r = await client.get(
        "/v1/school/student/history",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    assert r.json() == {"courses": []}
