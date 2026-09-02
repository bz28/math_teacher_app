"""Teacher "Preview as student" — the shadow account must be able to see
the homework the teacher is previewing.

The regression this guards: the shadow hit the same student-side gates a
real student does, so previewing a *draft* always 403'd ("Assignment is
not published") and previewing a homework pushed to only some sections
403'd ("Not enrolled") — both surfaced to the teacher as the generic
"We hit a snag" page with no hint of why. Previewing before publishing
is the entire point of the button, so the shadow is now waived through
both gates inside its owning teacher's own courses.

The whole state matrix (draft/published × four section targetings) runs
here because the two failures had different causes and only the matrix
shows they're both closed.
"""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Submission, SubmissionGrade
from api.models.question_bank import QuestionBankItem
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from tests.conftest import TINY_PNG, auth_headers


async def _wipe() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE practice_activity, bank_consumption, assignment_sections, "
            "assignments, section_enrollments, sections, question_bank_items, units, "
            "course_teachers, courses, refresh_tokens, users, schools "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()


async def _approved_items(course_id: str, unit_id: str, assignment_id: str) -> list[str]:
    """Two approved bank items attached to the assignment — stands in for
    the generate + approve flow, which needs an LLM."""
    ids: list[str] = []
    async with get_session_factory()() as s:
        for i in range(2):
            item = QuestionBankItem(
                course_id=uuid.UUID(course_id),
                unit_id=uuid.UUID(unit_id),
                originating_assignment_id=uuid.UUID(assignment_id),
                title=f"Q{i + 1}",
                question=f"Evaluate sin({i + 1}pi/6)",
                solution_steps=[{"title": "Recall", "description": "unit circle"}],
                final_answer="1/2",
                distractors=["0", "1", "-1/2"],
                status="approved",
                source="generated",
            )
            s.add(item)
            await s.flush()
            ids.append(str(item.id))
        await s.commit()
    return ids


async def _teacher_with_homework(
    client: AsyncClient, *, sections: str, status: str,
) -> dict[str, Any]:
    """A teacher, a course, two sections, and one homework — built through
    the real endpoints so the fixture can't drift from the app.

    `sections` picks what the homework is assigned to: "blank" (the
    wizard's default, which publish fans out to every section),
    "first_only" / "second_only" (an explicit subset), or "both".
    """
    r = await client.post("/v1/auth/register", json={
        "email": f"teacher_{uuid.uuid4().hex[:8]}@school.edu",
        "password": "password123", "name": "Ms Teacher",
        "grade_level": 12, "role": "teacher", "signup_school_name": "Springfield High",
    })
    assert r.status_code in (200, 201), r.text
    headers = auth_headers(r.json()["access_token"])

    course_id = (await client.post(
        "/v1/teacher/courses", headers=headers,
        json={"name": "Trig/Pre-Calc", "subject": "math", "grade_level": 12},
    )).json()["id"]

    section_ids = [
        (await client.post(
            f"/v1/teacher/courses/{course_id}/sections", headers=headers,
            json={"name": name},
        )).json()["id"]
        for name in ("Period 2", "Period 4")
    ]

    unit_id = (await client.post(
        f"/v1/teacher/courses/{course_id}/units", headers=headers,
        json={"name": "Unit Circle"},
    )).json()["id"]

    assignment_id = (await client.post(
        f"/v1/teacher/courses/{course_id}/assignments", headers=headers,
        json={
            "title": "HW 1 — Unit Circle", "type": "homework",
            "unit_ids": [unit_id], "late_policy": "none",
        },
    )).json()["id"]

    r = await client.patch(
        f"/v1/teacher/assignments/{assignment_id}", headers=headers,
        json={"bank_item_ids": await _approved_items(course_id, unit_id, assignment_id)},
    )
    assert r.status_code == 200, r.text

    picked = {
        "blank": [], "first_only": [section_ids[0]],
        "second_only": [section_ids[1]], "both": section_ids,
    }[sections]
    if picked:
        r = await client.post(
            f"/v1/teacher/assignments/{assignment_id}/sections", headers=headers,
            json={"section_ids": picked},
        )
        assert r.status_code == 200, r.text

    if status == "published":
        r = await client.post(
            f"/v1/teacher/assignments/{assignment_id}/publish", headers=headers,
        )
        assert r.status_code == 200, r.text

    return {
        "headers": headers, "course_id": course_id, "unit_id": unit_id,
        "section_ids": section_ids, "assignment_id": assignment_id,
    }


async def _second_homework(
    client: AsyncClient, world: dict[str, Any], *, section_ids: list[str],
) -> str:
    """Another published homework in the same course, targeted at one
    section — for checking what happens when the teacher previews a
    second homework that lives in a different period than the first."""
    headers = world["headers"]
    assignment_id = (await client.post(
        f"/v1/teacher/courses/{world['course_id']}/assignments", headers=headers,
        json={
            "title": "HW 2", "type": "homework",
            "unit_ids": [world["unit_id"]], "late_policy": "none",
        },
    )).json()["id"]
    r = await client.patch(
        f"/v1/teacher/assignments/{assignment_id}", headers=headers,
        json={"bank_item_ids": await _approved_items(
            world["course_id"], world["unit_id"], assignment_id,
        )},
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/teacher/assignments/{assignment_id}/sections", headers=headers,
        json={"section_ids": section_ids},
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/teacher/assignments/{assignment_id}/publish", headers=headers,
    )
    assert r.status_code == 200, r.text
    return assignment_id


async def _preview_headers(
    client: AsyncClient, world: dict[str, Any], *, for_assignment: bool = True,
) -> dict[str, str]:
    body = {"assignment_id": world["assignment_id"]} if for_assignment else {}
    r = await client.post(
        "/v1/teacher/preview-student", headers=world["headers"], json=body,
    )
    assert r.status_code == 200, r.text
    return auth_headers(r.json()["access_token"])


# ── The matrix ──

@pytest.mark.parametrize("status", ["draft", "published"])
@pytest.mark.parametrize("sections", ["blank", "first_only", "second_only", "both"])
async def test_preview_sees_homework_in_every_state(
    client: AsyncClient, status: str, sections: str,
) -> None:
    """Every draft/published × section-targeting combination. Before the
    fix, only 3 of these 8 passed."""
    await _wipe()
    world = await _teacher_with_homework(client, sections=sections, status=status)
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}",
        headers=await _preview_headers(client, world),
    )
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "HW 1 — Unit Circle"
    assert len(r.json()["problems"]) == 2
    # Drives the draft flag on her preview — nothing else on the student
    # page distinguishes unpublished work from live work.
    assert r.json()["published"] is (status == "published")


async def test_preview_lands_in_a_targeted_section(client: AsyncClient) -> None:
    """Passing the assignment moves the shadow to a section that homework
    was actually pushed to — not the earliest-created one we'd otherwise
    default to."""
    await _wipe()
    world = await _teacher_with_homework(client, sections="second_only", status="published")
    await _preview_headers(client, world)

    async with get_session_factory()() as s:
        shadow = (await s.execute(
            select(User).where(User.is_preview.is_(True))
        )).scalar_one()
        enrolled = (await s.execute(
            select(SectionEnrollment.section_id).where(
                SectionEnrollment.student_id == shadow.id,
            )
        )).scalars().all()

    assert [str(sid) for sid in enrolled] == [world["section_ids"][1]]


async def test_sidebar_preview_leaves_an_existing_seat_alone(client: AsyncClient) -> None:
    """The sidebar's preview entry point names no homework, so it has no
    opinion about which section she should sit in — it must not yank her
    out of the seat a homework preview just put her in."""
    await _wipe()
    world = await _teacher_with_homework(client, sections="second_only", status="published")
    await _preview_headers(client, world)  # seats her in Period 4

    await _preview_headers(client, world, for_assignment=False)  # sidebar

    async with get_session_factory()() as s:
        shadow = (await s.execute(
            select(User).where(User.is_preview.is_(True))
        )).scalar_one()
        enrolled = (await s.execute(
            select(SectionEnrollment.section_id).where(
                SectionEnrollment.student_id == shadow.id,
            )
        )).scalars().all()

    assert [str(sid) for sid in enrolled] == [world["section_ids"][1]]


async def test_preview_without_an_assignment_still_works(client: AsyncClient) -> None:
    """The sidebar's preview entry point sends no assignment — it must
    still enroll the shadow and reach the student dashboard."""
    await _wipe()
    world = await _teacher_with_homework(client, sections="both", status="published")
    headers = await _preview_headers(client, world, for_assignment=False)

    r = await client.get("/v1/school/student/dashboard", headers=headers)
    assert r.status_code == 200, r.text
    r = await client.get("/v1/school/student/classes", headers=headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1


@pytest.mark.parametrize("status", ["draft", "published"])
async def test_preview_can_rehearse_turning_in_repeatedly(
    client: AsyncClient, status: str,
) -> None:
    """A teacher has to be able to walk the whole loop — upload through
    review — and to do it more than once. One-shot exists so a student
    can't resubmit after seeing feedback; applied to her own shadow it
    would mean a single rehearsal permanently burned the flow on this
    homework, since nothing deletes a submission. Her rehearsal is
    replaced instead, so she never accumulates rows either."""
    await _wipe()
    world = await _teacher_with_homework(client, sections="both", status=status)
    headers = await _preview_headers(client, world)

    first = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=headers, json={"files": [TINY_PNG]},
    )
    assert first.status_code == 200, first.text

    second = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=headers, json={"files": [TINY_PNG]},
    )
    assert second.status_code == 200, second.text
    assert second.json()["submission_id"] != first.json()["submission_id"]

    async with get_session_factory()() as s:
        count = (await s.execute(
            select(func.count()).select_from(Submission).where(
                Submission.assignment_id == uuid.UUID(world["assignment_id"]),
            )
        )).scalar_one()
    assert count == 1


async def test_real_student_still_gets_one_shot(client: AsyncClient) -> None:
    """The replace path is scoped to preview shadows — a real student
    who submits twice still gets the 409."""
    await _wipe()
    world = await _teacher_with_homework(client, sections="both", status="published")
    student_id, token = await _make_student("oneshot@school.edu")
    async with get_session_factory()() as s:
        s.add(SectionEnrollment(
            student_id=student_id,
            section_id=uuid.UUID(world["section_ids"][0]),
            course_id=uuid.UUID(world["course_id"]),
        ))
        await s.commit()

    first = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=auth_headers(token), json={"files": [TINY_PNG]},
    )
    assert first.status_code == 200, first.text
    second = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=auth_headers(token), json={"files": [TINY_PNG]},
    )
    assert second.status_code == 409
    assert second.json()["detail"] == "Already submitted"


async def test_preview_keeps_a_seat_the_homework_already_targets(
    client: AsyncClient,
) -> None:
    """Only a seat the homework does NOT reach justifies moving the row.
    Churning one that already works would orphan the shadow's earlier
    rehearsals into a section it no longer occupies."""
    await _wipe()
    world = await _teacher_with_homework(client, sections="second_only", status="published")
    await _preview_headers(client, world)  # seats her in Period 4

    # A second homework that goes to BOTH periods — Period 4 included,
    # so her existing seat already sees it.
    both = await _second_homework(client, world, section_ids=world["section_ids"])
    r = await client.post(
        "/v1/teacher/preview-student", headers=world["headers"],
        json={"assignment_id": both},
    )
    assert r.status_code == 200, r.text

    async with get_session_factory()() as s:
        shadow = (await s.execute(
            select(User).where(User.is_preview.is_(True))
        )).scalar_one()
        enrolled = (await s.execute(
            select(SectionEnrollment.section_id).where(
                SectionEnrollment.student_id == shadow.id,
            )
        )).scalars().all()

    assert [str(sid) for sid in enrolled] == [world["section_ids"][1]]


async def test_preview_moves_the_seat_to_the_previewed_homework(
    client: AsyncClient,
) -> None:
    """Previewing a homework in a period the shadow isn't sitting in
    moves its seat. The row is updated in place — one enrollment per
    (student, course) is a DB constraint, so a second row isn't an
    option."""
    await _wipe()
    world = await _teacher_with_homework(client, sections="first_only", status="published")
    await _preview_headers(client, world)  # seats her in Period 2

    hw2 = await _second_homework(client, world, section_ids=[world["section_ids"][1]])
    r = await client.post(
        "/v1/teacher/preview-student", headers=world["headers"],
        json={"assignment_id": hw2},
    )
    assert r.status_code == 200, r.text

    async with get_session_factory()() as s:
        shadow = (await s.execute(
            select(User).where(User.is_preview.is_(True))
        )).scalar_one()
        enrolled = (await s.execute(
            select(SectionEnrollment.section_id).where(
                SectionEnrollment.student_id == shadow.id,
            )
        )).scalars().all()

    # Moved, not duplicated.
    assert [str(sid) for sid in enrolled] == [world["section_ids"][1]]
    r = await client.get(
        f"/v1/school/student/homework/{hw2}",
        headers=auth_headers(r.json()["access_token"]),
    )
    assert r.status_code == 200, r.text


# ── The gates still hold for everyone else ──

async def _make_student(email: str) -> tuple[uuid.UUID, str]:
    async with get_session_factory()() as s:
        student = User(
            email=email, password_hash=hash_password("x"),
            grade_level=12, role="student", name="Real Student",
        )
        s.add(student)
        await s.commit()
        return student.id, create_access_token(str(student.id), "student")


async def test_real_student_still_cannot_see_a_draft(client: AsyncClient) -> None:
    await _wipe()
    world = await _teacher_with_homework(client, sections="both", status="draft")
    student_id, token = await _make_student("real@school.edu")
    async with get_session_factory()() as s:
        s.add(SectionEnrollment(
            student_id=student_id,
            section_id=uuid.UUID(world["section_ids"][0]),
            course_id=uuid.UUID(world["course_id"]),
        ))
        await s.commit()

    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}",
        headers=auth_headers(token),
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Assignment is not published"


async def test_unenrolled_student_still_blocked(client: AsyncClient) -> None:
    await _wipe()
    world = await _teacher_with_homework(client, sections="both", status="published")
    _, token = await _make_student("outsider@school.edu")

    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}",
        headers=auth_headers(token),
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Not enrolled in this assignment"


@pytest.mark.parametrize(
    "victim_status,expected",
    [
        # Exercises the publish waiver...
        ("draft", "Assignment is not published"),
        # ...and the enrollment waiver, which a draft never reaches.
        ("published", "Not enrolled in this assignment"),
    ],
)
async def test_another_teachers_shadow_is_blocked(
    client: AsyncClient, victim_status: str, expected: str,
) -> None:
    """The waiver is scoped to courses the shadow's OWNER teaches.

    The intruding teacher gets a full course of her own, so her
    `teacher_course_ids` is non-empty and the scoping predicate is what
    does the blocking. Without that, this passes for the trivial reason
    that a teacher with no courses reaches nothing — and would still
    pass with the course scoping deleted entirely."""
    await _wipe()
    victim = await _teacher_with_homework(client, sections="both", status=victim_status)
    other = await _teacher_with_homework(client, sections="both", status="published")

    # Her own preview works, so we know her shadow is live and seated.
    own = await _preview_headers(client, other)
    r = await client.get(
        f"/v1/school/student/homework/{other['assignment_id']}", headers=own,
    )
    assert r.status_code == 200, r.text

    # Naming the victim's assignment must not seat her in his course.
    r = await client.post(
        "/v1/teacher/preview-student", headers=other["headers"],
        json={"assignment_id": victim["assignment_id"]},
    )
    assert r.status_code == 200, r.text
    intruder = auth_headers(r.json()["access_token"])

    r = await client.get(
        f"/v1/school/student/homework/{victim['assignment_id']}", headers=intruder,
    )
    assert r.status_code == 403
    assert r.json()["detail"] == expected

    async with get_session_factory()() as s:
        seats = (await s.execute(
            select(SectionEnrollment.section_id)
            .join(User, User.id == SectionEnrollment.student_id)
            .where(User.is_preview.is_(True))
        )).scalars().all()
    assert not (set(map(str, seats)) & set(victim["section_ids"]))


async def test_a_rehearsal_grade_can_be_published_so_she_can_see_it(
    client: AsyncClient,
) -> None:
    """The back half of the loop. A rehearsal runs the real pipeline and
    gets a real grade — but publish-grades is the only writer of
    grade_published_at, and it used to exclude her, so the student view
    she was checking could never show a score. Her grade releases with
    the class now; the counts still leave her out."""
    await _wipe()
    world = await _teacher_with_homework(client, sections="both", status="published")
    headers = await _preview_headers(client, world)

    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=headers, json={"files": [TINY_PNG]},
    )
    assert r.status_code == 200, r.text
    submission_id = uuid.UUID(r.json()["submission_id"])

    # Stand in for the grading pipeline, which needs an LLM.
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(submission_id=submission_id, final_score=92.0))
        await s.commit()

    # Nothing to see yet — the score exists but was never released.
    detail = (await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}", headers=headers,
    )).json()
    assert detail["final_score"] is None

    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/publish-grades",
        headers=world["headers"], json={},
    )
    assert r.status_code == 200, r.text

    detail = (await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}", headers=headers,
    )).json()
    assert detail["final_score"] == 92.0
    assert detail["grade_published_at"] is not None

    # ...and she still isn't one of her own students.
    listed = (await client.get(
        f"/v1/teacher/courses/{world['course_id']}/assignments",
        headers=world["headers"],
    )).json()
    row = next(
        a for a in listed["assignments"]
        if a["id"] == world["assignment_id"]
    )
    assert row["submitted"] == 0
    assert row["published"] == 0
