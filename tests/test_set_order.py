"""A homework's problems keep the order they were read or written in.

2026-11-24: a 6-problem worksheet upload came back as 6, 1, 2, 3, 4, 5.
Each persist batch shared one created_at (the column default is the
transaction's start), the review queue listed newest first, and approval
appended in click order — so the homework's order was whatever the
teacher happened to click.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.auth import create_access_token, hash_password
from api.core.question_bank_generation import _run_generation
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.unit import Unit
from api.models.user import User


async def _seed() -> dict[str, Any]:
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        teacher = User(email=f"t_{tag}@t.com", password_hash=hash_password("x"),
                       grade_level=12, role="teacher", name="T")
        course = Course(name="Algebra 1", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Unit 3", position=0)
        s.add(unit)
        await s.flush()
        hw = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                        title="HW 3.2", type="homework", status="draft")
        s.add(hw)
        await s.commit()
        return {"teacher_id": teacher.id, "course_id": course.id, "unit_id": unit.id, "hw_id": hw.id,
                "token": create_access_token(str(teacher.id), "teacher")}


@pytest.mark.asyncio
async def test_a_generated_set_is_stored_in_the_order_it_was_written() -> None:
    # Seven problems spans two persist batches (_PROGRESS_BATCH = 5).
    w = await _seed()
    async with get_session_factory()() as s:
        job = QuestionBankGenerationJob(
            course_id=w["course_id"], unit_id=w["unit_id"], originating_assignment_id=w["hw_id"],
            created_by_id=w["teacher_id"], status="queued", requested_count=7,
        )
        s.add(job)
        await s.commit()
        job_id = job.id

    texts = [f"Solve {n}x = {n * 2}" for n in range(1, 8)]
    gen = AsyncMock(return_value=[{"title": t, "text": t, "difficulty": "easy"} for t in texts])
    solve = AsyncMock(side_effect=lambda qs, **_: [
        {"question_text": q, "steps": [], "final_answer": "2"} for q in qs
    ])
    with (
        patch("api.core.question_bank_generation.generate_questions", gen),
        patch("api.core.question_bank_generation.generate_solutions", solve),
        patch("api.core.question_bank_generation.generate_distractors", AsyncMock(return_value=[])),
    ):
        async with get_session_factory()() as s:
            job = (await s.execute(
                select(QuestionBankGenerationJob).where(QuestionBankGenerationJob.id == job_id)
            )).scalar_one()
            await _run_generation(s, job)

    async with get_session_factory()() as s:
        rows = (await s.execute(
            select(QuestionBankItem.question, QuestionBankItem.created_at)
            .where(QuestionBankItem.originating_assignment_id == w["hw_id"])
            .order_by(QuestionBankItem.created_at)
        )).all()
    assert [r.question for r in rows] == texts
    # The review page sorts in the browser, whose Date keeps milliseconds:
    # stamps that differ only below that tie there.
    ms = [r.created_at.replace(microsecond=r.created_at.microsecond // 1000 * 1000) for r in rows]
    assert len(set(ms)) == len(ms), "each problem needs its own millisecond"


async def _pending(w: dict[str, Any], n: int, *, made: datetime) -> list[uuid.UUID]:
    async with get_session_factory()() as s:
        items = [
            QuestionBankItem(
                course_id=w["course_id"], unit_id=w["unit_id"], originating_assignment_id=w["hw_id"],
                title=f"Problem {i + 1}", question=f"Problem {i + 1}", final_answer="1",
                status="pending", source="imported", created_at=made + timedelta(milliseconds=i + 1),
            )
            for i in range(n)
        ]
        s.add_all(items)
        await s.commit()
        return [i.id for i in items]


async def _approve(client: AsyncClient, w: dict[str, Any], item_id: uuid.UUID) -> None:
    r = await client.post(f"/v1/teacher/question-bank/{item_id}/approve",
                          headers={"Authorization": f"Bearer {w['token']}"})
    assert r.status_code == 200, r.text


async def _problem_ids(w: dict[str, Any]) -> list[str]:
    async with get_session_factory()() as s:
        hw = (await s.execute(select(Assignment).where(Assignment.id == w["hw_id"]))).scalar_one()
    return [str(p) for p in (hw.content or {}).get("problem_ids") or []]


@pytest.mark.asyncio
async def test_approving_out_of_order_keeps_the_sets_order(client: AsyncClient) -> None:
    w = await _seed()
    ids = await _pending(w, 6, made=datetime.now(UTC))
    # Problem 6 first (the old newest-first queue), then a skip-and-return.
    for i in (5, 0, 2, 1, 4, 3):
        await _approve(client, w, ids[i])
    assert await _problem_ids(w) == [str(i) for i in ids]


@pytest.mark.asyncio
async def test_a_problem_from_elsewhere_keeps_its_place(client: AsyncClient) -> None:
    # A problem attached from another homework sits first; this set's own
    # problems file after it in their order, whatever its timestamp.
    w = await _seed()
    other = await _seed()
    async with get_session_factory()() as s:
        borrowed = QuestionBankItem(
            course_id=w["course_id"], unit_id=w["unit_id"], originating_assignment_id=other["hw_id"],
            title="Borrowed", question="Borrowed", final_answer="1", status="approved",
            source="generated", created_at=datetime.now(UTC) + timedelta(days=1),
        )
        s.add(borrowed)
        await s.flush()
        hw = (await s.execute(select(Assignment).where(Assignment.id == w["hw_id"]))).scalar_one()
        hw.content = {"problem_ids": [str(borrowed.id)]}
        await s.commit()
        borrowed_id = borrowed.id
    ids = await _pending(w, 3, made=datetime.now(UTC))
    for i in (2, 0, 1):
        await _approve(client, w, ids[i])
    assert await _problem_ids(w) == [str(borrowed_id)] + [str(i) for i in ids]
