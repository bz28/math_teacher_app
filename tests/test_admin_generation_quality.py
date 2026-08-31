"""Admin: which generated questions teachers had to fix.

The page answers "is our generation prompt wrong?", and the evidence is
teachers rewriting what it produced. These pin the two things that make
it trustworthy rather than merely pretty:

1. **Ranking.** Most-repaired first. Newest-first would make the reader
   do the analysis; the whole point is that the page does it.
2. **Honesty about what isn't known.** `question_edits` only records
   forward — the intermediate states of every pre-existing edit are
   gone. An empty result must be reported alongside when tracking began,
   or a zero reads as "never edited" and asserts the opposite of the
   truth on the one surface built to make quality legible.
"""

import uuid
from datetime import UTC, datetime, timedelta
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
    EDIT_WORKSHOP,
    FIELD_QUESTION,
    QuestionEdit,
)
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers as _auth

pytestmark = pytest.mark.asyncio


async def _seed(edit_plan: list[tuple[str, int]]) -> dict[str, Any]:
    """Seed an admin plus one question per (title, edit_count) pair."""
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
        # `originating_assignment_id` is NOT NULL — every bank item
        # belongs to the HW its generation was kicked off from.
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW", type="homework", status="published",
            content={"problem_ids": []},
        )
        s.add(assignment)
        await s.flush()

        item_ids: dict[str, uuid.UUID] = {}
        base = datetime.now(UTC) - timedelta(days=1)
        for title, n in edit_plan:
            item = QuestionBankItem(
                course_id=course.id, unit_id=unit.id,
                originating_assignment_id=assignment.id,
                title=title, question=f"{title} v0",
                solution_steps=[], final_answer="x",
                status="approved", source="generated",
                generation_prompt="Make 5 quadratics for a mixed-ability class.",
            )
            s.add(item)
            await s.flush()
            item_ids[title] = item.id
            for i in range(n):
                s.add(QuestionEdit(
                    bank_item_id=item.id, edited_by_id=teacher.id,
                    school_id=school.id,
                    kind=EDIT_MANUAL if i % 2 == 0 else EDIT_WORKSHOP,
                    field=FIELD_QUESTION,
                    before=f"{title} v{i}", after=f"{title} v{i + 1}",
                    created_at=base + timedelta(minutes=i),
                ))
        await s.commit()
        return {
            "token": create_access_token(str(admin.id), "admin"),
            "teacher_id": str(teacher.id),
            "school_id": str(school.id),
            "items": {k: str(v) for k, v in item_ids.items()},
        }


async def test_questions_rank_by_how_much_repair_they_needed(
    client: AsyncClient,
) -> None:
    w = await _seed([("Lightly touched", 1), ("Heavily fought", 4), ("Middling", 2)])
    r = await client.get(
        "/v1/admin/generation-quality/questions", headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Most-repaired first. Chronological would make the reader do the
    # analysis; the page is supposed to do it.
    assert [q["title"] for q in body["questions"]] == [
        "Heavily fought", "Middling", "Lightly touched",
    ]
    assert [q["edit_count"] for q in body["questions"]] == [4, 2, 1]
    assert body["total"] == 3


async def test_min_edits_filters_out_the_noise(client: AsyncClient) -> None:
    w = await _seed([("Once", 1), ("Thrice", 3)])
    r = await client.get(
        "/v1/admin/generation-quality/questions?min_edits=2",
        headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    assert [q["title"] for q in r.json()["questions"]] == ["Thrice"]


async def test_an_empty_result_still_says_when_tracking_began(
    client: AsyncClient,
) -> None:
    """The honesty guard. Without `tracking_since`, an empty page reads
    as "no teacher has ever edited a question" — the opposite of the
    truth, on the surface built to make quality legible."""
    w = await _seed([])
    r = await client.get(
        "/v1/admin/generation-quality/questions", headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["questions"] == []
    assert body["total"] == 0
    assert body["tracking_since"], "must report when counting started"


async def test_history_returns_the_diffs_oldest_first(
    client: AsyncClient,
) -> None:
    """A count tells you WHICH question to look at; only the before/after
    tells you what the prompt got wrong."""
    w = await _seed([("Fought", 3)])
    r = await client.get(
        f"/v1/admin/generation-quality/questions/{w['items']['Fought']}",
        headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["edits"]) == 3
    assert [e["after"] for e in body["edits"]] == [
        "Fought v1", "Fought v2", "Fought v3",
    ]
    # The prompt that produced it — the thing you actually change.
    assert "quadratics" in body["generation_prompt"]
    assert body["edits"][0]["editor"] == "Ms Rivera"
    assert body["edits"][0]["school"] == "Lincoln High"


async def test_filters_scope_to_a_school_and_a_kind(client: AsyncClient) -> None:
    w = await _seed([("A", 2)])
    ok = await client.get(
        f"/v1/admin/generation-quality/questions?school_id={w['school_id']}",
        headers=_auth(w["token"]),
    )
    assert ok.status_code == 200
    assert len(ok.json()["questions"]) == 1

    other = await client.get(
        f"/v1/admin/generation-quality/questions?school_id={uuid.uuid4()}",
        headers=_auth(w["token"]),
    )
    assert other.status_code == 200
    assert other.json()["questions"] == []

    chat_only = await client.get(
        f"/v1/admin/generation-quality/questions?kind={EDIT_WORKSHOP}",
        headers=_auth(w["token"]),
    )
    assert chat_only.status_code == 200
    # 2 edits: one manual, one chat — so it survives a chat-only filter
    # but with a lower count.
    assert chat_only.json()["questions"][0]["edit_count"] == 1


async def test_a_teacher_cannot_read_the_admin_console(
    client: AsyncClient,
) -> None:
    w = await _seed([("A", 1)])
    teacher_token = create_access_token(w["teacher_id"], "teacher")
    r = await client.get(
        "/v1/admin/generation-quality/questions", headers=_auth(teacher_token),
    )
    assert r.status_code == 403
