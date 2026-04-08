"""Regression tests for the variation-as-HW-primary bug.

Background: a teacher generated a similar variation in the workshop
modal, then clicked "→ Add to Homework". The frontend's
showAddToHomework condition was missing a parent_question_id check,
so the button was visible for variations. The backend's
snapshot_bank_items was also missing the same check, so the variation
got stamped into assignment.content.problem_ids as a sibling primary
and showed up to the student as a duplicate HW problem.

The fix is two layers:
- snapshot_bank_items rejects items with parent_question_id != NULL
  (single source of truth for everything that writes problem_ids)
- Workshop modal hides the Add to Homework button for variations
  and shows an "Approve as practice" button instead

These tests lock down the backend layer at every entry point — once
green, the bug cannot regress without breaking CI.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.database import get_session_factory
from api.models.question_bank import QuestionBankItem
from api.services.bank import snapshot_bank_items


async def _approved_variation(world: dict[str, Any]) -> QuestionBankItem:
    """Promote one of the seeded approved siblings into a row we can
    test directly. The world fixture's siblings are already approved
    + carry parent_question_id, which is exactly the shape we need."""
    async with get_session_factory()() as s:
        from sqlalchemy import select
        sib_id = world["approved_sibling_ids"][0]
        return (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == sib_id)
        )).scalar_one()


async def _seed_unit(course_id: Any) -> str:
    """Create a unit on the seeded course. Required by the create-
    assignment validator (unit_ids must be non-empty)."""
    from api.models.unit import Unit
    async with get_session_factory()() as s:
        u = Unit(course_id=course_id, name="test unit", position=0)
        s.add(u)
        await s.commit()
        return str(u.id)


async def _link_teacher_to_course(teacher_id: Any, course_id: Any) -> None:
    """The world fixture seeds an Assignment owned by the teacher but
    doesn't create a CourseTeacher row, so endpoints that gate on
    course ownership (get_teacher_course) reject the teacher with a
    403. Add the link explicitly for tests that hit those endpoints."""
    from api.models.course import CourseTeacher
    async with get_session_factory()() as s:
        s.add(CourseTeacher(course_id=course_id, teacher_id=teacher_id, role="owner"))
        await s.commit()


async def test_snapshot_bank_items_rejects_variation(
    world: dict[str, Any],
) -> None:
    """The data-layer guard. Calling snapshot_bank_items with any
    variation id raises a 400 with the explicit error message."""
    from fastapi import HTTPException

    sib = await _approved_variation(world)
    async with get_session_factory()() as s:
        with pytest.raises(HTTPException) as exc:
            await snapshot_bank_items(
                s,
                world["assignment_id"]
                if False  # noop — we want the course id, not assignment
                else (await s.execute(
                    text("SELECT course_id FROM assignments WHERE id=:id"),
                    {"id": world["assignment_id"]},
                )).scalar_one(),
                [sib.id],
            )
        assert exc.value.status_code == 400
        assert "variation" in exc.value.detail.lower() \
            or "practice" in exc.value.detail.lower()


async def test_snapshot_bank_items_rejects_mixed_payload(
    world: dict[str, Any],
) -> None:
    """If the payload contains a primary AND a variation, the whole
    call rejects (no partial writes). This protects the most likely
    real-world misuse: kid+variation in one batch."""
    from fastapi import HTTPException

    sib = await _approved_variation(world)
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            text("SELECT course_id FROM assignments WHERE id=:id"),
            {"id": world["assignment_id"]},
        )).scalar_one()
        with pytest.raises(HTTPException) as exc:
            await snapshot_bank_items(s, course_id, [world["primary_id"], sib.id])
        assert exc.value.status_code == 400


async def test_create_assignment_rejects_variation_in_bank_item_ids(
    client: AsyncClient,
    world: dict[str, Any],
) -> None:
    """Entry point #1: POST /v1/teacher/courses/{id}/assignments.
    Going through the create endpoint with a variation in
    bank_item_ids must 400 — proves the snapshot helper is wired
    into the create path."""
    sib = await _approved_variation(world)
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            text("SELECT course_id FROM assignments WHERE id=:id"),
            {"id": world["assignment_id"]},
        )).scalar_one()
    unit_id = await _seed_unit(course_id)
    await _link_teacher_to_course(world["teacher_id"], course_id)

    r = await client.post(
        f"/v1/teacher/courses/{course_id}/assignments",
        headers={"Authorization": f"Bearer {world['teacher_token']}"},
        json={
            "title": "Bad HW",
            "type": "homework",
            "unit_ids": [unit_id],
            "bank_item_ids": [str(sib.id)],
        },
    )
    assert r.status_code == 400
    assert "variation" in r.json()["detail"].lower() \
        or "practice" in r.json()["detail"].lower()


async def test_update_assignment_rejects_variation_in_bank_item_ids(
    client: AsyncClient,
    world: dict[str, Any],
) -> None:
    """Entry point #2: PATCH /v1/teacher/assignments/{id}.
    The BankPicker UI uses this when a teacher edits a HW's
    problems. Updating with a variation in the new bank_item_ids
    list must 400."""
    # Need to unpublish first since the existing world HW is published.
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET status='draft' WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()

    sib = await _approved_variation(world)
    r = await client.patch(
        f"/v1/teacher/assignments/{world['assignment_id']}",
        headers={"Authorization": f"Bearer {world['teacher_token']}"},
        json={"bank_item_ids": [str(world["primary_id"]), str(sib.id)]},
    )
    assert r.status_code == 400


async def test_approve_attach_rejects_variation(
    client: AsyncClient,
    world: dict[str, Any],
) -> None:
    """Entry point #3: POST /v1/teacher/question-bank/{id}/approve
    with assignment_id. This is the workshop modal "→ Add to
    Homework" path that triggered the original bug. Must 400 even
    though it's the same endpoint primaries use."""
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            text("SELECT course_id FROM assignments WHERE id=:id"),
            {"id": world["assignment_id"]},
        )).scalar_one()
    await _link_teacher_to_course(world["teacher_id"], course_id)

    # Unpublish the seeded HW so the approve+attach path is allowed
    # at all (already-published HWs reject content edits).
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET status='draft' WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()

    sib = await _approved_variation(world)
    # The variation is already approved in the world fixture; flip
    # it back to pending so the approve endpoint runs the full path.
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE question_bank_items SET status='pending' WHERE id=:id"),
            {"id": sib.id},
        )
        await s.commit()

    r = await client.post(
        f"/v1/teacher/question-bank/{sib.id}/approve",
        headers={"Authorization": f"Bearer {world['teacher_token']}"},
        json={"assignment_id": str(world["assignment_id"])},
    )
    assert r.status_code == 400


async def test_primaries_still_work(
    client: AsyncClient,
    world: dict[str, Any],
) -> None:
    """Sanity check: the new guard rejects variations but does NOT
    reject primaries. The seeded HW already has the primary on it
    via the world fixture, so we exercise the create-assignment
    path with the primary alone."""
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            text("SELECT course_id FROM assignments WHERE id=:id"),
            {"id": world["assignment_id"]},
        )).scalar_one()
    unit_id = await _seed_unit(course_id)
    await _link_teacher_to_course(world["teacher_id"], course_id)

    r = await client.post(
        f"/v1/teacher/courses/{course_id}/assignments",
        headers={"Authorization": f"Bearer {world['teacher_token']}"},
        json={
            "title": "Good HW",
            "type": "homework",
            "unit_ids": [unit_id],
            "bank_item_ids": [str(world["primary_id"])],
        },
    )
    assert r.status_code == 201, r.text
