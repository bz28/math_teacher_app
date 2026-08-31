"""Solution quality — scoring the solve call.

`GET /v1/admin/quality` reports whether the AI's worked answers held up,
judged by whether a teacher had to fix them.

This replaced an LLM judge that never ran once. The call site shipped
commented out and was later deleted, so `quality_scores` was empty by
construction and the page rendered a red "WEAK" verdict with 0.0/5 on
every dimension — a confident verdict from no evidence, which is the one
thing a quality page must never do.

The rules pinned here:

- A solution is judged only once its QUESTION is approved. A rejected
  question's solution never got a real look, and a pending one has not
  been judged — counting either would put an unexamined solution in the
  numerator or the denominator.
- A QUESTION edit does not make the solution dirty, and vice versa. They
  indict two different prompts, and confusing them sends you to change
  the wrong one.
- The two exclusions are reported by reason, not lumped together.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.models.question_edit import (
    EDIT_MANUAL,
    FIELD_FINAL_ANSWER,
    FIELD_QUESTION,
    FIELD_SOLUTION,
    TRACKING_SINCE,
    QuestionEdit,
)
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers as _auth

pytestmark = pytest.mark.asyncio

URL = "/v1/admin/quality"


async def _world() -> dict[str, Any]:
    """One question per solution outcome, plus the rows that must not count."""
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE question_edits, question_bank_items, units, "
            "courses, schools, sessions, users RESTART IDENTITY CASCADE"
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
            grade_level=12, role="teacher", name="Ms Rivera",
            school_id=school.id,
        )
        course = Course(name="Algebra", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        unit = Unit(course_id=course.id, name="U", position=0)
        s.add(unit)
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW", type="homework", status="published",
            content={"problem_ids": []},
        )
        s.add(assignment)
        await s.flush()

        after = TRACKING_SINCE + timedelta(days=1)

        def _item(**kw: Any) -> QuestionBankItem:
            base: dict[str, Any] = dict(
                course_id=course.id, unit_id=unit.id,
                originating_assignment_id=assignment.id,
                question="q", solution_steps=[], final_answer="x",
                source="generated", created_at=after,
            )
            base.update(kw)
            return QuestionBankItem(**base)

        items = {
            "held": _item(title="Held up", status="approved"),
            "steps_fixed": _item(title="Steps fixed", status="approved"),
            "answer_fixed": _item(title="Answer fixed", status="approved"),
            # The question text was rewritten but the solution was not —
            # that indicts the GENERATION prompt, not the solve.
            "question_only": _item(title="Question only", status="approved"),
            "rejected": _item(title="Binned", status="rejected"),
            "pending": _item(title="Pending", status="pending"),
        }
        s.add_all(list(items.values()))
        await s.flush()

        def _edit(item: QuestionBankItem, field: str) -> QuestionEdit:
            return QuestionEdit(
                bank_item_id=item.id, edited_by_id=teacher.id,
                school_id=school.id, kind=EDIT_MANUAL, field=field,
                before="b", after="a",
            )

        s.add_all([
            _edit(items["steps_fixed"], FIELD_SOLUTION),
            _edit(items["answer_fixed"], FIELD_FINAL_ANSWER),
            _edit(items["question_only"], FIELD_QUESTION),
        ])
        await s.commit()
        return {
            "token": create_access_token(str(admin.id), "admin"),
            "items": {k: str(v.id) for k, v in items.items()},
        }


async def test_only_approved_questions_have_a_judged_solution(
    client: AsyncClient,
) -> None:
    """A binned question's solution never got a real look and a pending
    one has not been judged. Counting either would put an unexamined
    solution in the numerator or the denominator."""
    w = await _world()
    r = await client.get(URL, headers=_auth(w["token"]))
    assert r.status_code == 200, r.text
    summary = r.json()["summary"]

    # The four approved questions. Not the binned one, not the pending one.
    assert summary["judged"] == 4
    assert summary["clean"] == 2      # held up + question-only
    assert summary["repaired"] == 2   # steps + final answer
    assert summary["clean_rate"] == 50.0
    # Reported by REASON, not lumped into one "not counted" figure.
    assert summary["question_rejected"] == 1
    assert summary["awaiting"] == 1


async def test_a_question_edit_does_not_make_the_solution_dirty(
    client: AsyncClient,
) -> None:
    """The whole reason `field` exists. Rewriting the question indicts
    the GENERATION prompt; blaming the solve for it would send you to
    change the wrong prompt."""
    w = await _world()
    r = await client.get(
        URL, params={"outcome": "clean"}, headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    titles = sorted(q["title"] for q in r.json()["questions"])
    assert titles == ["Held up", "Question only"]


async def test_both_solve_fields_count_as_a_repair(
    client: AsyncClient,
) -> None:
    """`decompose` produces the steps AND the final answer, so a teacher
    fixing either is saying the same thing: the solve was wrong."""
    w = await _world()
    r = await client.get(
        URL, params={"outcome": "repaired"}, headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    titles = sorted(q["title"] for q in r.json()["questions"])
    assert titles == ["Answer fixed", "Steps fixed"]


async def test_repairs_lead_the_list(client: AsyncClient) -> None:
    """A solution nobody touched has nothing to debug."""
    w = await _world()
    r = await client.get(URL, headers=_auth(w["token"]))
    outcomes = [q["outcome"] for q in r.json()["questions"]]
    assert outcomes[:2] == ["repaired", "repaired"]
    assert set(outcomes[2:]) == {"clean"}


async def test_the_drill_in_shows_only_solution_repairs(
    client: AsyncClient,
) -> None:
    """The diff is the payload — and it must be the SOLVE diff. Showing a
    question rewrite under 'The AI solved it as' would misattribute the
    defect to the wrong prompt."""
    w = await _world()
    r = await client.get(
        f"{URL}/{w['items']['question_only']}", headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    # The item HAS an edit, but it is a question edit — not this page's.
    assert r.json()["edits"] == []

    r2 = await client.get(
        f"{URL}/{w['items']['steps_fixed']}", headers=_auth(w["token"]),
    )
    assert r2.status_code == 200, r2.text
    edits = r2.json()["edits"]
    assert len(edits) == 1
    assert edits[0]["field"] == FIELD_SOLUTION


async def test_an_unknown_outcome_is_rejected_not_ignored(
    client: AsyncClient,
) -> None:
    w = await _world()
    r = await client.get(
        URL, params={"outcome": "nonsense"}, headers=_auth(w["token"]),
    )
    assert r.status_code == 400, r.text


async def test_a_thin_sample_says_so(client: AsyncClient) -> None:
    """Four judged solutions cannot support a percentage."""
    w = await _world()
    r = await client.get(URL, headers=_auth(w["token"]))
    assert r.json()["summary"]["thin"] is True


async def test_a_teacher_cannot_read_the_admin_console(
    client: AsyncClient,
) -> None:
    w = await _world()
    async with get_session_factory()() as s:
        teacher_id = (await s.execute(
            text("SELECT id FROM users WHERE role = 'teacher' LIMIT 1")
        )).scalar_one()
    r = await client.get(
        URL, headers=_auth(create_access_token(str(teacher_id), "teacher")),
    )
    assert r.status_code == 403, r.text
    assert w  # fixture used
