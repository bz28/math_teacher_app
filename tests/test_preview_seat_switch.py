"""Moving a preview's seat between class periods.

A teacher's shadow holds one seat per course, so she can only ever see
one class period at a time. That's the right shape — a real student sits
in one period — but it left her unable to answer "did this go to the
right class?", which needs both the period that has the homework and the
one that shouldn't.

These endpoints live on the student router because in preview the
browser holds the shadow's tokens; the guard is that the shadow's owner
teaches the course.
"""

import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy import delete, select, text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Submission
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


async def _teacher() -> dict[str, str]:
    async with get_session_factory()() as s:
        t = User(
            email=f"t_{uuid.uuid4().hex[:8]}@school.edu",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Ms Teacher",
        )
        s.add(t)
        await s.commit()
        return auth_headers(create_access_token(str(t.id), "teacher"))


async def _course_with_homework(
    client: AsyncClient, headers: dict[str, str], *, target: str,
) -> dict[str, Any]:
    """Two periods and one published homework, sent to `target`:
    "first", "second", or "both"."""
    course_id = (await client.post(
        "/v1/teacher/courses", headers=headers,
        json={"name": "Trig/Pre-Calc", "subject": "math", "grade_level": 12},
    )).json()["id"]
    section_ids = [
        (await client.post(
            f"/v1/teacher/courses/{course_id}/sections", headers=headers,
            json={"name": n},
        )).json()["id"]
        for n in ("Period 2", "Period 4")
    ]
    unit_id = (await client.post(
        f"/v1/teacher/courses/{course_id}/units", headers=headers,
        json={"name": "Unit Circle"},
    )).json()["id"]
    assignment_id = (await client.post(
        f"/v1/teacher/courses/{course_id}/assignments", headers=headers,
        json={
            "title": "HW 1", "type": "homework",
            "unit_ids": [unit_id], "late_policy": "none",
        },
    )).json()["id"]

    ids = []
    async with get_session_factory()() as s:
        for i in range(2):
            item = QuestionBankItem(
                course_id=uuid.UUID(course_id), unit_id=uuid.UUID(unit_id),
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
    await client.patch(
        f"/v1/teacher/assignments/{assignment_id}", headers=headers,
        json={"bank_item_ids": ids},
    )
    picked = {
        "first": [section_ids[0]], "second": [section_ids[1]],
        "both": section_ids,
    }[target]
    await client.post(
        f"/v1/teacher/assignments/{assignment_id}/sections", headers=headers,
        json={"section_ids": picked},
    )
    r = await client.post(
        f"/v1/teacher/assignments/{assignment_id}/publish", headers=headers,
    )
    assert r.status_code == 200, r.text
    return {
        "course_id": course_id, "section_ids": section_ids,
        "assignment_id": assignment_id, "unit_id": unit_id,
    }


async def _preview(
    client: AsyncClient, headers: dict[str, str], assignment_id: str | None = None,
) -> dict[str, str]:
    body = {"assignment_id": assignment_id} if assignment_id else {}
    r = await client.post("/v1/teacher/preview-student", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return auth_headers(r.json()["access_token"])


async def test_seats_list_every_period_and_marks_the_current_one(
    client: AsyncClient,
) -> None:
    await _wipe()
    headers = await _teacher()
    world = await _course_with_homework(client, headers, target="second")
    preview = await _preview(client, headers, world["assignment_id"])

    r = await client.get(
        f"/v1/school/student/preview/courses/{world['course_id']}/seats",
        headers=preview,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["course_name"] == "Trig/Pre-Calc"
    assert [s["name"] for s in body["seats"]] == ["Period 2", "Period 4"]
    # Opening a Period-4-only homework seated her there.
    current = [s for s in body["seats"] if s["current"]]
    assert [s["name"] for s in current] == ["Period 4"]


async def test_switching_seats_changes_what_the_preview_can_see(
    client: AsyncClient,
) -> None:
    """The point of the feature: check the period that has the homework
    AND confirm the one that shouldn't, doesn't."""
    await _wipe()
    headers = await _teacher()
    world = await _course_with_homework(client, headers, target="second")
    preview = await _preview(client, headers, world["assignment_id"])

    # Seated in Period 4 — the homework is there.
    r = await client.get(
        f"/v1/school/student/courses/{world['course_id']}/homework",
        headers=preview,
    )
    assert [h["title"] for h in r.json()] == ["HW 1"]

    r = await client.post(
        f"/v1/school/student/preview/courses/{world['course_id']}/seat",
        headers=preview, json={"section_id": world["section_ids"][0]},
    )
    assert r.status_code == 200, r.text

    # Now in Period 2, which was excluded — it correctly isn't there.
    r = await client.get(
        f"/v1/school/student/courses/{world['course_id']}/homework",
        headers=preview,
    )
    assert r.json() == []

    async with get_session_factory()() as s:
        shadow = (await s.execute(
            select(User).where(User.is_preview.is_(True))
        )).scalar_one()
        seats = (await s.execute(
            select(SectionEnrollment.section_id).where(
                SectionEnrollment.student_id == shadow.id,
            )
        )).scalars().all()
    # Moved, not duplicated — one enrollment per course is a constraint.
    assert [str(sid) for sid in seats] == [world["section_ids"][0]]


async def test_the_homework_page_itself_follows_the_seat(
    client: AsyncClient,
) -> None:
    """The answer has to be the same on the homework page as in the list.

    Switching seats reloads without changing the URL, so a teacher
    checking "is this hidden from Period 2?" is usually standing on the
    homework page when she switches. If the detail endpoint kept
    returning 200 there she'd read that as "Period 2 can see it" — a
    confident wrong answer to the exact question the switcher exists to
    ask. (It did, until the preview waiver stopped covering section
    targeting.)"""
    await _wipe()
    headers = await _teacher()
    world = await _course_with_homework(client, headers, target="second")
    preview = await _preview(client, headers, world["assignment_id"])

    # Seated in Period 4, which the homework was sent to.
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}", headers=preview,
    )
    assert r.status_code == 200, r.text

    await client.post(
        f"/v1/school/student/preview/courses/{world['course_id']}/seat",
        headers=preview, json={"section_id": world["section_ids"][0]},
    )

    # Period 2 was excluded — the page must say so, not show the work.
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}", headers=preview,
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Not enrolled in this assignment"

    # And she can't rehearse a turn-in from a period that never got it.
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=preview, json={"files": [TINY_PNG]},
    )
    assert r.status_code == 403

    # Switching back restores it — a switcher you can't switch back
    # with is a trap rather than a tool.
    await client.post(
        f"/v1/school/student/preview/courses/{world['course_id']}/seat",
        headers=preview, json={"section_id": world["section_ids"][1]},
    )
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}", headers=preview,
    )
    assert r.status_code == 200, r.text


async def test_a_homework_targeting_nothing_previews_from_any_seat(
    client: AsyncClient,
) -> None:
    """The narrowed waiver must not re-break the original bug. A
    homework with NO sections — the wizard's blank default, before
    publish fans it out — has nothing for the join to match, so it
    previews from whichever seat she holds."""
    await _wipe()
    headers = await _teacher()
    world = await _course_with_homework(client, headers, target="both")
    await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/unpublish",
        headers=headers,
    )
    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/sections",
        headers=headers, json={"section_ids": []},
    )
    assert r.status_code == 200, r.text
    preview = await _preview(client, headers, world["assignment_id"])

    for section_id in world["section_ids"]:
        await client.post(
            f"/v1/school/student/preview/courses/{world['course_id']}/seat",
            headers=preview, json={"section_id": section_id},
        )
        r = await client.get(
            f"/v1/school/student/homework/{world['assignment_id']}",
            headers=preview,
        )
        assert r.status_code == 200, r.text


async def test_a_draft_with_sections_still_respects_them(
    client: AsyncClient,
) -> None:
    """"It's a draft" is NOT a reason to ignore targeting.

    Sections can only be edited while a draft — `assign_to_sections`
    400s once published — so the draft phase is exactly when a teacher
    picks them, and "did this go to the right class?" is a question she
    asks before publishing. Waiving targeting for drafts would leave the
    switcher confidently wrong for the whole period she most needs it."""
    await _wipe()
    headers = await _teacher()
    world = await _course_with_homework(client, headers, target="second")
    await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/unpublish",
        headers=headers,
    )
    preview = await _preview(client, headers, world["assignment_id"])

    # Seated where the draft is aimed.
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}", headers=preview,
    )
    assert r.status_code == 200, r.text

    await client.post(
        f"/v1/school/student/preview/courses/{world['course_id']}/seat",
        headers=preview, json={"section_id": world["section_ids"][0]},
    )
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}", headers=preview,
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Not enrolled in this assignment"


async def test_a_rehearsal_on_an_untargeted_draft_still_lands_somewhere(
    client: AsyncClient,
) -> None:
    """The section fallback in _section_for_student_work, which nothing
    covered. A homework targeting no sections has no rows to join
    against, so a rehearsal's Submission row can only get its section
    from the shadow's own seat."""
    await _wipe()
    headers = await _teacher()
    world = await _course_with_homework(client, headers, target="both")
    await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/unpublish",
        headers=headers,
    )
    await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/sections",
        headers=headers, json={"section_ids": []},
    )
    preview = await _preview(client, headers, world["assignment_id"])

    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=preview, json={"files": [TINY_PNG]},
    )
    assert r.status_code == 200, r.text

    async with get_session_factory()() as s:
        shadow = (await s.execute(
            select(User).where(User.is_preview.is_(True))
        )).scalar_one()
        seat = (await s.execute(
            select(SectionEnrollment.section_id).where(
                SectionEnrollment.student_id == shadow.id,
            )
        )).scalar_one()
        stamped = (await s.execute(
            select(Submission.section_id).where(
                Submission.id == uuid.UUID(r.json()["submission_id"]),
            )
        )).scalar_one()
    assert stamped == seat


async def test_a_section_from_another_course_is_refused(
    client: AsyncClient,
) -> None:
    """The section has to belong to the course in the path — otherwise
    the course_id mirror on the enrollment row would go stale and the
    one-per-course constraint would stop meaning anything."""
    await _wipe()
    headers = await _teacher()
    world = await _course_with_homework(client, headers, target="both")
    other = await _course_with_homework(client, headers, target="both")
    preview = await _preview(client, headers, world["assignment_id"])

    r = await client.post(
        f"/v1/school/student/preview/courses/{world['course_id']}/seat",
        headers=preview, json={"section_id": other["section_ids"][0]},
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "Section is not part of this course"


async def test_a_real_student_cannot_move_their_own_seat(
    client: AsyncClient,
) -> None:
    """The whole point of a section is that a student doesn't choose it."""
    await _wipe()
    headers = await _teacher()
    world = await _course_with_homework(client, headers, target="both")

    async with get_session_factory()() as s:
        st = User(
            email="kid@school.edu", password_hash=hash_password("x"),
            grade_level=12, role="student", name="Real Student",
        )
        s.add(st)
        await s.flush()
        s.add(SectionEnrollment(
            student_id=st.id,
            section_id=uuid.UUID(world["section_ids"][0]),
            course_id=uuid.UUID(world["course_id"]),
        ))
        await s.commit()
        student = auth_headers(create_access_token(str(st.id), "student"))

    r = await client.get(
        f"/v1/school/student/preview/courses/{world['course_id']}/seats",
        headers=student,
    )
    assert r.status_code == 403
    r = await client.post(
        f"/v1/school/student/preview/courses/{world['course_id']}/seat",
        headers=student, json={"section_id": world["section_ids"][1]},
    )
    assert r.status_code == 403

    async with get_session_factory()() as s:
        seat = (await s.execute(
            select(SectionEnrollment.section_id).where(
                SectionEnrollment.student_id == st.id,
            )
        )).scalar_one()
    assert str(seat) == world["section_ids"][0]


async def test_another_teachers_shadow_cannot_seat_itself_here(
    client: AsyncClient,
) -> None:
    await _wipe()
    headers = await _teacher()
    world = await _course_with_homework(client, headers, target="both")

    other_teacher = await _teacher()
    other_world = await _course_with_homework(client, other_teacher, target="both")
    intruder = await _preview(client, other_teacher, other_world["assignment_id"])

    r = await client.get(
        f"/v1/school/student/preview/courses/{world['course_id']}/seats",
        headers=intruder,
    )
    assert r.status_code == 403
    r = await client.post(
        f"/v1/school/student/preview/courses/{world['course_id']}/seat",
        headers=intruder, json={"section_id": world["section_ids"][0]},
    )
    assert r.status_code == 403


async def test_a_shadow_with_no_seat_yet_gets_one(client: AsyncClient) -> None:
    """The insert branch. A shadow normally has a seat by the time it
    can switch, but a deleted section cascades its enrollment away —
    switching then has to create one rather than fail."""
    await _wipe()
    headers = await _teacher()
    world = await _course_with_homework(client, headers, target="both")
    preview = await _preview(client, headers, world["assignment_id"])

    async with get_session_factory()() as s:
        shadow = (await s.execute(
            select(User).where(User.is_preview.is_(True))
        )).scalar_one()
        await s.execute(delete(SectionEnrollment).where(
            SectionEnrollment.student_id == shadow.id,
        ))
        await s.commit()

    r = await client.get(
        f"/v1/school/student/preview/courses/{world['course_id']}/seats",
        headers=preview,
    )
    assert r.status_code == 200
    assert not any(seat["current"] for seat in r.json()["seats"])

    r = await client.post(
        f"/v1/school/student/preview/courses/{world['course_id']}/seat",
        headers=preview, json={"section_id": world["section_ids"][0]},
    )
    assert r.status_code == 200, r.text

    async with get_session_factory()() as s:
        seats = (await s.execute(
            select(SectionEnrollment.section_id).where(
                SectionEnrollment.student_id == shadow.id,
            )
        )).scalars().all()
    assert [str(sid) for sid in seats] == [world["section_ids"][0]]


async def test_work_made_in_one_seat_survives_a_switch(
    client: AsyncClient,
) -> None:
    """A rehearsal keeps the section it was made in. That's deliberate —
    the row records where the work happened — and it must not be
    rewritten or orphaned when she moves on to check another period."""
    await _wipe()
    headers = await _teacher()
    world = await _course_with_homework(client, headers, target="both")
    preview = await _preview(client, headers, world["assignment_id"])

    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=preview, json={"files": [TINY_PNG]},
    )
    assert r.status_code == 200, r.text
    submission_id = uuid.UUID(r.json()["submission_id"])

    async with get_session_factory()() as s:
        made_in = (await s.execute(
            select(Submission.section_id).where(Submission.id == submission_id)
        )).scalar_one()

    await client.post(
        f"/v1/school/student/preview/courses/{world['course_id']}/seat",
        headers=preview,
        json={
            "section_id": next(
                sid for sid in world["section_ids"] if sid != str(made_in)
            ),
        },
    )

    async with get_session_factory()() as s:
        still = (await s.execute(
            select(Submission.section_id).where(Submission.id == submission_id)
        )).scalar_one()
    assert still == made_in


async def test_a_practice_set_follows_the_seat_too(client: AsyncClient) -> None:
    """The homework page and the practice page have to agree.

    Both are course-scoped routes, so the switcher renders on both, and
    switching reloads whichever one she's on. Review found the practice
    page still showing the generic "we couldn't load this" for a correct
    403 — the exact symptom #854 existed to remove, one surface over."""
    await _wipe()
    headers = await _teacher()
    world = await _course_with_homework(client, headers, target="second")

    # A practice set aimed at Period 4 only, alongside the homework.
    practice_id = (await client.post(
        f"/v1/teacher/courses/{world['course_id']}/assignments", headers=headers,
        json={
            "title": "Practice 1", "type": "practice",
            "unit_ids": [world["unit_id"]], "late_policy": "none",
        },
    )).json()["id"]
    async with get_session_factory()() as s:
        item = QuestionBankItem(
            course_id=uuid.UUID(world["course_id"]),
            unit_id=uuid.UUID(world["unit_id"]),
            originating_assignment_id=uuid.UUID(practice_id),
            title="P1", question="p", solution_steps=[{"title": "s", "description": "d"}],
            final_answer="1", distractors=["a", "b", "c"],
            status="approved", source="practice",
        )
        s.add(item)
        await s.commit()
    await client.post(
        f"/v1/teacher/assignments/{practice_id}/sections", headers=headers,
        json={"section_ids": [world["section_ids"][1]]},
    )
    r = await client.post(
        f"/v1/teacher/assignments/{practice_id}/publish", headers=headers,
    )
    assert r.status_code == 200, r.text

    preview = await _preview(client, headers, world["assignment_id"])
    r = await client.get(
        f"/v1/school/student/practice/{practice_id}", headers=preview,
    )
    assert r.status_code == 200, r.text

    await client.post(
        f"/v1/school/student/preview/courses/{world['course_id']}/seat",
        headers=preview, json={"section_id": world["section_ids"][0]},
    )
    r = await client.get(
        f"/v1/school/student/practice/{practice_id}", headers=preview,
    )
    assert r.status_code == 403
    # Same detail string the frontend keys its redirect on, for both
    # surfaces — if this ever changes, both redirects break together.
    assert r.json()["detail"] == "Not enrolled in this assignment"
