"""Publishing with the section picker left blank.

The wizard tells a teacher "Leave empty to assign to every section in
this course", and the review step reads "All sections in this course".
That promise is kept by a fan-out inside `publish_assignment` — and one
of our first teachers didn't believe it, so it's worth pinning rather
than trusting the copy.

Also pins the states where an empty section list means the opposite
(published, then its sections deleted) and the sharp edge where it means
neither (a section created after publishing).
"""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import AssignmentSection
from api.models.question_bank import QuestionBankItem
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from tests.conftest import auth_headers


async def _wipe() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE practice_activity, bank_consumption, assignment_sections, "
            "assignments, section_enrollments, sections, question_bank_items, units, "
            "course_teachers, courses, refresh_tokens, users, schools "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()


async def _teacher() -> dict[str, str]:
    # No school — section targeting has nothing to do with school
    # affiliation, and an independent teacher exercises the same path.
    async with get_session_factory()() as s:
        t = User(
            email=f"t_{uuid.uuid4().hex[:8]}@school.edu",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Ms Teacher",
        )
        s.add(t)
        await s.commit()
        return auth_headers(create_access_token(str(t.id), "teacher"))


async def _student_in(section_id: str, course_id: str, email: str) -> dict[str, str]:
    async with get_session_factory()() as s:
        st = User(
            email=email, password_hash=hash_password("x"),
            grade_level=12, role="student", name=email.split("@")[0],
        )
        s.add(st)
        await s.flush()
        s.add(SectionEnrollment(
            student_id=st.id,
            section_id=uuid.UUID(section_id),
            course_id=uuid.UUID(course_id),
        ))
        await s.commit()
        return auth_headers(create_access_token(str(st.id), "student"))


async def _course(
    client: AsyncClient, headers: dict[str, str], section_names: list[str],
) -> dict[str, Any]:
    course_id = (await client.post(
        "/v1/teacher/courses", headers=headers,
        json={"name": "Trig/Pre-Calc", "subject": "math", "grade_level": 12},
    )).json()["id"]
    section_ids = [
        (await client.post(
            f"/v1/teacher/courses/{course_id}/sections", headers=headers,
            json={"name": n},
        )).json()["id"]
        for n in section_names
    ]
    unit_id = (await client.post(
        f"/v1/teacher/courses/{course_id}/units", headers=headers,
        json={"name": "Unit Circle"},
    )).json()["id"]
    return {"course_id": course_id, "section_ids": section_ids, "unit_id": unit_id}


async def _draft_homework(
    client: AsyncClient, headers: dict[str, str], world: dict[str, Any],
) -> str:
    """A draft with problems attached and the section picker left blank —
    exactly what the wizard produces on its defaults."""
    assignment_id = (await client.post(
        f"/v1/teacher/courses/{world['course_id']}/assignments", headers=headers,
        json={
            "title": "HW 1", "type": "homework",
            "unit_ids": [world["unit_id"]], "late_policy": "none",
        },
    )).json()["id"]
    ids = []
    async with get_session_factory()() as s:
        for i in range(2):
            item = QuestionBankItem(
                course_id=uuid.UUID(world["course_id"]),
                unit_id=uuid.UUID(world["unit_id"]),
                originating_assignment_id=uuid.UUID(assignment_id),
                title=f"Q{i + 1}", question=f"q{i + 1}",
                solution_steps=[{"title": "s", "description": "d"}],
                final_answer="1", distractors=["a", "b", "c"],
                status="approved", source="generated",
            )
            s.add(item)
            await s.flush()
            ids.append(str(item.id))
        await s.commit()
    r = await client.patch(
        f"/v1/teacher/assignments/{assignment_id}", headers=headers,
        json={"bank_item_ids": ids},
    )
    assert r.status_code == 200, r.text
    return assignment_id


async def _assigned_section_count(assignment_id: str) -> int:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(func.count()).select_from(AssignmentSection).where(
                AssignmentSection.assignment_id == uuid.UUID(assignment_id),
            )
        )).scalar_one()


@pytest.mark.parametrize("section_names", [
    ["Period 2"],
    ["Period 2", "Period 4"],
    ["Period 1", "Period 3", "Period 5", "Period 7"],
])
async def test_blank_sections_publishes_to_every_section(
    client: AsyncClient, section_names: list[str],
) -> None:
    """The promise the wizard makes: leave it blank, everyone gets it.

    Checked from both ends — the join rows exist, AND a real student in
    each section can actually open the homework."""
    await _wipe()
    headers = await _teacher()
    world = await _course(client, headers, section_names)
    assignment_id = await _draft_homework(client, headers, world)

    # Nothing is assigned while it's a draft — the fan-out is what
    # publishing does, not what creating does.
    assert await _assigned_section_count(assignment_id) == 0

    r = await client.post(
        f"/v1/teacher/assignments/{assignment_id}/publish", headers=headers,
    )
    assert r.status_code == 200, r.text

    assert await _assigned_section_count(assignment_id) == len(section_names)
    detail = (await client.get(
        f"/v1/teacher/assignments/{assignment_id}", headers=headers,
    )).json()
    assert sorted(detail["section_names"]) == sorted(section_names)

    for i, section_id in enumerate(world["section_ids"]):
        student = await _student_in(
            section_id, world["course_id"], f"kid{i}@school.edu",
        )
        r = await client.get(
            f"/v1/school/student/homework/{assignment_id}", headers=student,
        )
        assert r.status_code == 200, f"{section_names[i]}: {r.text}"


async def test_explicit_sections_are_not_widened_by_publish(
    client: AsyncClient,
) -> None:
    """The picker is for exclusions. Naming one section must mean one
    section — the fan-out only fires on an empty list."""
    await _wipe()
    headers = await _teacher()
    world = await _course(client, headers, ["Period 2", "Period 4"])
    assignment_id = await _draft_homework(client, headers, world)

    r = await client.post(
        f"/v1/teacher/assignments/{assignment_id}/sections", headers=headers,
        json={"section_ids": [world["section_ids"][1]]},
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/teacher/assignments/{assignment_id}/publish", headers=headers,
    )
    assert r.status_code == 200, r.text

    assert await _assigned_section_count(assignment_id) == 1

    included = await _student_in(
        world["section_ids"][1], world["course_id"], "included@school.edu",
    )
    excluded = await _student_in(
        world["section_ids"][0], world["course_id"], "excluded@school.edu",
    )
    assert (await client.get(
        f"/v1/school/student/homework/{assignment_id}", headers=included,
    )).status_code == 200
    r = await client.get(
        f"/v1/school/student/homework/{assignment_id}", headers=excluded,
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Not enrolled in this assignment"


async def test_blank_sections_with_no_sections_at_all_is_refused(
    client: AsyncClient,
) -> None:
    """"Every section" of nothing is nobody, so publishing is blocked
    with a fix rather than silently going out to an empty audience."""
    await _wipe()
    headers = await _teacher()
    world = await _course(client, headers, [])
    assignment_id = await _draft_homework(client, headers, world)

    r = await client.post(
        f"/v1/teacher/assignments/{assignment_id}/publish", headers=headers,
    )
    assert r.status_code == 400
    assert "no sections yet" in r.json()["detail"]


async def test_deleting_every_section_leaves_a_published_hw_reaching_nobody(
    client: AsyncClient,
) -> None:
    """The one state where an empty section list is a problem rather than
    the default — which is why the teacher UI says "No sections" here and
    "All sections" on a draft."""
    await _wipe()
    headers = await _teacher()
    world = await _course(client, headers, ["Period 2"])
    assignment_id = await _draft_homework(client, headers, world)
    await client.post(
        f"/v1/teacher/assignments/{assignment_id}/publish", headers=headers,
    )
    assert await _assigned_section_count(assignment_id) == 1

    r = await client.delete(
        f"/v1/teacher/courses/{world['course_id']}"
        f"/sections/{world['section_ids'][0]}",
        headers=headers,
    )
    assert r.status_code in (200, 204), r.text

    assert await _assigned_section_count(assignment_id) == 0
    detail = (await client.get(
        f"/v1/teacher/assignments/{assignment_id}", headers=headers,
    )).json()
    assert detail["status"] == "published"
    assert detail["section_names"] == []


async def test_a_section_created_after_publish_does_not_receive_it(
    client: AsyncClient,
) -> None:
    """Pins today's behavior, which is a sharp edge rather than a
    decision: the fan-out is a snapshot taken at publish time, so a class
    period added mid-term gets none of the homework already out there.
    Change this deliberately, not by accident."""
    await _wipe()
    headers = await _teacher()
    world = await _course(client, headers, ["Period 2"])
    assignment_id = await _draft_homework(client, headers, world)
    await client.post(
        f"/v1/teacher/assignments/{assignment_id}/publish", headers=headers,
    )

    late = (await client.post(
        f"/v1/teacher/courses/{world['course_id']}/sections", headers=headers,
        json={"name": "Period 6"},
    )).json()["id"]

    assert await _assigned_section_count(assignment_id) == 1
    newcomer = await _student_in(late, world["course_id"], "late@school.edu")
    r = await client.get(
        f"/v1/school/student/homework/{assignment_id}", headers=newcomer,
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Not enrolled in this assignment"


async def test_republishing_after_a_manual_clear_fans_out_again(
    client: AsyncClient,
) -> None:
    """Unpublishing keeps the section rows, so the ordinary edit loop
    doesn't re-fan. But a teacher who clears the picker back to empty
    gets the blank default again on the next publish."""
    await _wipe()
    headers = await _teacher()
    world = await _course(client, headers, ["Period 2", "Period 4"])
    assignment_id = await _draft_homework(client, headers, world)
    await client.post(
        f"/v1/teacher/assignments/{assignment_id}/publish", headers=headers,
    )
    assert await _assigned_section_count(assignment_id) == 2

    await client.post(
        f"/v1/teacher/assignments/{assignment_id}/unpublish", headers=headers,
    )
    # Unpublish alone leaves the targeting intact.
    assert await _assigned_section_count(assignment_id) == 2

    # Clear it the way a teacher does — deselecting every chip in the
    # picker, which posts an empty list. Reaching into the table would
    # skip the endpoint and let a regression there go unnoticed.
    r = await client.post(
        f"/v1/teacher/assignments/{assignment_id}/sections", headers=headers,
        json={"section_ids": []},
    )
    assert r.status_code == 200, r.text
    assert await _assigned_section_count(assignment_id) == 0

    await client.post(
        f"/v1/teacher/assignments/{assignment_id}/publish", headers=headers,
    )
    assert await _assigned_section_count(assignment_id) == 2
