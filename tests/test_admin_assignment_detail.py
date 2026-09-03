"""Admin: one assignment, as the teacher built it.

The page exists to show the artifact — the problems a teacher kept and
published — which neither the activity log nor GenerationQuality shows.
These pin the parts that are easy to get quietly wrong:

1. **Practice assignments resolve at all.** They don't populate
   `content.problem_ids`; their problems are derived by querying approved
   bank items. Reading content directly returns an empty list, which
   renders as "no problems" on an assignment that has six — a wrong
   answer that looks like a working page.
2. **Provenance is never guessed.** A legacy snapshot has no bank item to
   read `source` from, so it gets no badge rather than a fabricated one.
3. **A deleted problem leaves a hole, not a renumbering.** Positions must
   describe what students saw.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.models.question_edit import (
    EDIT_MANUAL,
    FIELD_QUESTION,
    QuestionEdit,
)
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers as _auth

pytestmark = pytest.mark.asyncio


async def _world() -> dict[str, Any]:
    """An admin, a teacher, a course/unit and a section to hang HWs off."""
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE question_edits, question_bank_items, "
            "assignment_sections, assignments, sections, units, courses, "
            "schools, sessions, users RESTART IDENTITY CASCADE"
        ))
        admin = User(
            email=f"a_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=99, role="admin", name="A",
        )
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Admin", contact_email="admin@lincoln.edu",
        )
        s.add_all([admin, school])
        await s.flush()
        teacher = User(
            email=f"t_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms Ortega",
            school_id=school.id,
        )
        course = Course(name="Algebra I", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        unit = Unit(course_id=course.id, name="Unit 2", position=0)
        section = Section(course_id=course.id, name="Period 3")
        s.add_all([unit, section])
        await s.flush()
        await s.commit()
        return {
            "token": create_access_token(str(admin.id), "admin"),
            "teacher_id": teacher.id,
            "school_id": school.id,
            "course_id": course.id,
            "unit_id": unit.id,
            "section_id": section.id,
        }


async def _add_assignment(
    w: dict[str, Any], *, type_: str, content: Any, published: bool = True,
) -> uuid.UUID:
    async with get_session_factory()() as s:
        a = Assignment(
            course_id=w["course_id"], unit_ids=[w["unit_id"]],
            teacher_id=w["teacher_id"], title="HW 4 — Distributing",
            type=type_, status="published" if published else "draft",
            content=content,
        )
        s.add(a)
        await s.flush()
        s.add(AssignmentSection(
            assignment_id=a.id, section_id=w["section_id"],
            published_at=datetime.now(UTC) - timedelta(days=1) if published else None,
        ))
        await s.commit()
        return a.id


async def _add_item(
    w: dict[str, Any], assignment_id: uuid.UUID, *,
    question: str, source: str = "generated", status_: str = "approved",
    edits: int = 0,
) -> uuid.UUID:
    async with get_session_factory()() as s:
        item = QuestionBankItem(
            course_id=w["course_id"], unit_id=w["unit_id"],
            originating_assignment_id=assignment_id,
            title=question[:40], question=question,
            solution_steps=[], final_answer="42",
            status=status_, source=source,
        )
        s.add(item)
        await s.flush()
        for i in range(edits):
            s.add(QuestionEdit(
                bank_item_id=item.id, edited_by_id=w["teacher_id"],
                school_id=w["school_id"], kind=EDIT_MANUAL, field=FIELD_QUESTION,
                before=f"v{i}", after=f"v{i + 1}",
            ))
        await s.commit()
        return item.id


async def test_practice_assignment_resolves_its_problems(
    client: AsyncClient,
) -> None:
    """The case that reading `content` directly gets wrong.

    A practice set's items are bank *variations*, which the snapshot path
    rejects, so `content.problem_ids` is empty by design and the problems
    are derived from `originating_assignment_id`. Reading content here
    would report an empty assignment that in fact has two problems.
    """
    w = await _world()
    a_id = await _add_assignment(w, type_="practice", content={"problem_ids": []})
    await _add_item(w, a_id, question="Practice one")
    await _add_item(w, a_id, question="Practice two")

    r = await client.get(f"/v1/admin/assignments/{a_id}", headers=_auth(w["token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [p["question"] for p in body["problems"]] == ["Practice one", "Practice two"]
    assert [p["position"] for p in body["problems"]] == [1, 2]


async def test_provenance_distinguishes_generated_edited_and_handwritten(
    client: AsyncClient,
) -> None:
    w = await _world()
    a_id = await _add_assignment(w, type_="homework", content={"problem_ids": []})
    untouched = await _add_item(w, a_id, question="Untouched", source="generated")
    edited = await _add_item(w, a_id, question="Edited", source="generated", edits=2)
    manual = await _add_item(w, a_id, question="Typed", source="manual")
    async with get_session_factory()() as s:
        await s.execute(text("UPDATE assignments SET content = :c WHERE id = :i"), {
            "c": '{"problem_ids": ["%s", "%s", "%s"]}' % (untouched, edited, manual),
            "i": str(a_id),
        })
        await s.commit()

    r = await client.get(f"/v1/admin/assignments/{a_id}", headers=_auth(w["token"]))
    assert r.status_code == 200, r.text
    assert [p["provenance"] for p in r.json()["problems"]] == [
        "AI · approved", "AI · edited", "hand-written",
    ]


async def test_deleted_problem_leaves_a_hole_rather_than_renumbering(
    client: AsyncClient,
) -> None:
    """Positions describe what students saw, so the survivors keep theirs.

    The hydrator drops a dangling reference — correct for the teacher,
    who no longer has that problem — but an admin comparing "3 problems"
    against two rendered rows needs to see which slot went missing.
    """
    w = await _world()
    a_id = await _add_assignment(w, type_="homework", content={"problem_ids": []})
    first = await _add_item(w, a_id, question="First")
    doomed = await _add_item(w, a_id, question="Doomed")
    third = await _add_item(w, a_id, question="Third")
    async with get_session_factory()() as s:
        await s.execute(text("UPDATE assignments SET content = :c WHERE id = :i"), {
            "c": '{"problem_ids": ["%s", "%s", "%s"]}' % (first, doomed, third),
            "i": str(a_id),
        })
        await s.execute(
            text("DELETE FROM question_bank_items WHERE id = :i"), {"i": str(doomed)},
        )
        await s.commit()

    r = await client.get(f"/v1/admin/assignments/{a_id}", headers=_auth(w["token"]))
    assert r.status_code == 200, r.text
    problems = r.json()["problems"]
    assert [p["position"] for p in problems] == [1, 2, 3]
    assert [p["missing"] for p in problems] == [False, True, False]
    # The surviving third problem keeps position 3 — renumbering it to 2
    # would describe an assignment nobody was given.
    assert problems[2]["question"] == "Third"
    assert problems[1]["question"] is None


async def test_draft_with_no_problems_is_not_an_error(
    client: AsyncClient,
) -> None:
    w = await _world()
    a_id = await _add_assignment(
        w, type_="homework", content=None, published=False,
    )
    r = await client.get(f"/v1/admin/assignments/{a_id}", headers=_auth(w["token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["problems"] == []
    assert body["status"] == "draft"
    # Never published: no invented publish time, and the section it was
    # assigned to reports its own null rather than inheriting one.
    assert body["first_published_at"] is None
    assert body["sections"][0]["published_at"] is None


async def test_publish_time_comes_from_the_section_not_the_assignment(
    client: AsyncClient,
) -> None:
    """`published_at` lives on the assignment↔section join.

    The same homework can go to Period 3 on Monday and Period 5 on
    Tuesday, so the header reports the FIRST time it went out and each
    section carries its own.
    """
    w = await _world()
    a_id = await _add_assignment(w, type_="homework", content={"problem_ids": []})
    async with get_session_factory()() as s:
        later = Section(course_id=w["course_id"], name="Period 5")
        s.add(later)
        await s.flush()
        s.add(AssignmentSection(
            assignment_id=a_id, section_id=later.id,
            published_at=datetime.now(UTC),
        ))
        await s.commit()

    r = await client.get(f"/v1/admin/assignments/{a_id}", headers=_auth(w["token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [s["name"] for s in body["sections"]] == ["Period 3", "Period 5"]
    # Earliest of the two, not the assignment row (which has no such column).
    assert body["first_published_at"] == min(
        s["published_at"] for s in body["sections"]
    )


async def test_missing_assignment_is_404_not_a_crash(client: AsyncClient) -> None:
    w = await _world()
    r = await client.get(
        f"/v1/admin/assignments/{uuid.uuid4()}", headers=_auth(w["token"]),
    )
    assert r.status_code == 404


async def test_teacher_cannot_read_the_admin_view(client: AsyncClient) -> None:
    w = await _world()
    a_id = await _add_assignment(w, type_="homework", content={"problem_ids": []})
    teacher_token = create_access_token(str(w["teacher_id"]), "teacher")
    r = await client.get(
        f"/v1/admin/assignments/{a_id}", headers=_auth(teacher_token),
    )
    assert r.status_code in (401, 403)


async def test_listing_returns_drafts_alongside_published(
    client: AsyncClient,
) -> None:
    """Drafts are the point of having a list at all.

    The activity log only records what a teacher DID in the window you
    are reading. An abandoned draft never generated an event worth
    logging, so it is invisible there and visible only here.
    """
    w = await _world()
    await _add_assignment(w, type_="homework", content={"problem_ids": []})
    await _add_assignment(
        w, type_="homework", content={"problem_ids": []}, published=False,
    )

    r = await client.get(
        f"/v1/admin/users/{w['teacher_id']}/assignments", headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2
    assert sorted(a["status"] for a in body["assignments"]) == ["draft", "published"]


async def test_listing_reports_no_count_for_practice_rather_than_zero(
    client: AsyncClient,
) -> None:
    """A practice set's problems aren't in `content`, so counting it there
    would report 0 for a set that has problems. Null says "ask the detail
    page", which is true; zero would be a lie the reader can't detect."""
    w = await _world()
    practice = await _add_assignment(
        w, type_="practice", content={"problem_ids": []},
    )
    await _add_item(w, practice, question="Practice one")

    r = await client.get(
        f"/v1/admin/users/{w['teacher_id']}/assignments", headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    row = next(a for a in r.json()["assignments"] if a["id"] == str(practice))
    assert row["problem_count"] is None
