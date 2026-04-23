"""Integration tests for the student Practice tab endpoints:
/v1/school/student/courses/{id}/practice (list),
/v1/school/student/practice/{id}           (detail),
/v1/school/student/homework/{id}/linked-practice (agent CTA lookup).

Uses the shared `world` fixture (teacher + student + course + section +
1 published HW) and layers on a linked practice assignment + its
approved variation so the three endpoints can be exercised end-to-end.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select, text

from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection
from api.models.question_bank import QuestionBankItem
from tests.conftest import auth_headers as _auth


async def _publish_linked_practice(
    world: dict[str, Any],
    *,
    status_value: str = "published",
    attach_to_section: bool = True,
) -> dict[str, Any]:
    """Create a published practice assignment cloned from the world
    HW, with one approved variation attached via
    originating_assignment_id. Returns ids the test can assert on."""
    async with get_session_factory()() as s:
        source_hw = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()

        practice = Assignment(
            course_id=source_hw.course_id,
            unit_ids=list(source_hw.unit_ids or []),
            teacher_id=world["teacher_id"],
            title=f"{source_hw.title} Practice",
            type="practice",
            status=status_value,
            source_homework_id=source_hw.id,
            content=None,
        )
        s.add(practice)
        await s.flush()

        # One approved variation originating from the practice,
        # parented to the HW's primary (simulating a clone generation
        # job's output).
        variation = QuestionBankItem(
            course_id=source_hw.course_id,
            originating_assignment_id=practice.id,
            title="Practice variation",
            question="Solve x^2 - 5x + 6 = 0 (practice).",
            solution_steps=[{"title": "Factor", "description": "(x-2)(x-3)"}],
            final_answer="x = 2 or x = 3",
            distractors=["x=1", "x=-2", "x=5"],
            status="approved",
            source="practice",
            parent_question_id=world["primary_id"],
        )
        s.add(variation)

        if attach_to_section:
            # Attach to the world's section so the student has visibility.
            section_id = (await s.execute(
                text(
                    "SELECT section_id FROM assignment_sections "
                    "WHERE assignment_id=:aid LIMIT 1"
                ),
                {"aid": world["assignment_id"]},
            )).scalar_one()
            s.add(AssignmentSection(
                assignment_id=practice.id,
                section_id=section_id,
                published_at=datetime.now(UTC),
            ))
        await s.commit()
        return {
            "practice_id": practice.id,
            "practice_title": practice.title,
            "variation_id": variation.id,
            "course_id": source_hw.course_id,
        }


# ── list_practice ──

async def test_list_practice_returns_published_linked_set(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _publish_linked_practice(world)
    r = await client.get(
        f"/v1/school/student/courses/{p['course_id']}/practice",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 1
    row = body[0]
    assert row["assignment_id"] == str(p["practice_id"])
    assert row["title"] == p["practice_title"]
    assert row["problem_count"] == 1
    assert row["source_homework_id"] == str(world["assignment_id"])
    assert row["source_homework_title"] == "HW 1"


async def test_list_practice_hides_drafts(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _publish_linked_practice(world, status_value="draft")
    r = await client.get(
        f"/v1/school/student/courses/{p['course_id']}/practice",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    assert r.json() == []


async def test_list_practice_hides_unassigned_sections(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Practice published but NOT attached to any section the student
    is enrolled in must not appear in their list — same section-scoped
    visibility rule as homework."""
    p = await _publish_linked_practice(world, attach_to_section=False)
    r = await client.get(
        f"/v1/school/student/courses/{p['course_id']}/practice",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    assert r.json() == []


# ── practice_detail ──

async def test_practice_detail_ships_full_problem_payload(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _publish_linked_practice(world)
    r = await client.get(
        f"/v1/school/student/practice/{p['practice_id']}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source_homework_title"] == "HW 1"
    assert len(body["problems"]) == 1
    prob = body["problems"][0]
    # Unlike HW primaries, practice problems ship answer + steps.
    assert prob["bank_item_id"] == str(p["variation_id"])
    assert prob["final_answer"] == "x = 2 or x = 3"
    assert prob["solution_steps"][0]["title"] == "Factor"
    assert prob["distractors"] == ["x=1", "x=-2", "x=5"]


async def test_practice_detail_rejects_non_practice_assignment(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Passing a homework id to the practice-detail endpoint must 404 —
    keeps cross-type ids opaque to the student."""
    r = await client.get(
        f"/v1/school/student/practice/{world['assignment_id']}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404


async def test_practice_detail_rejects_unenrolled_student(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _publish_linked_practice(world)
    r = await client.get(
        f"/v1/school/student/practice/{p['practice_id']}",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 403


# ── linked_practice_for_homework ──

async def test_linked_practice_returns_linked_set(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _publish_linked_practice(world)
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/linked-practice",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"practice_assignment_id": str(p["practice_id"])}


async def test_linked_practice_null_when_no_link(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """No practice cloned from this HW → null. The integrity-chat CTA
    uses this as the silent-no-nudge signal."""
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/linked-practice",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    assert r.json() == {"practice_assignment_id": None}


async def test_linked_practice_null_when_practice_is_draft(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A practice linked to the HW but still in draft should not be
    surfaced — nudging students into a draft would leak unfinished
    teacher work."""
    await _publish_linked_practice(world, status_value="draft")
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/linked-practice",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    assert r.json() == {"practice_assignment_id": None}


async def test_linked_practice_rejects_unenrolled_student(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/linked-practice",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 403


async def test_linked_practice_404_on_missing_homework(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    fake = uuid.uuid4()
    r = await client.get(
        f"/v1/school/student/homework/{fake}/linked-practice",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404
