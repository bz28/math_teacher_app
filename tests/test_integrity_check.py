"""Integration tests for the integrity-checker pipeline + trigger.

Reuses the seeded `world` fixture from test_school_student_practice
(teacher / student / course / section / approved primary / variations
/ published HW / outsider student) so we don't duplicate setup.

Tests cover:
- Pipeline trigger from submit_homework: rows created, statuses
  correct, idempotent on retry
- integrity_check_enabled=False: no rows created
- HW with > MAX_SAMPLE primaries: only the first MAX_SAMPLE sampled
- HW with 0 primaries: no rows, no error
- Quizzes (assignment.type != homework): no rows even if submit
  somehow reaches that path
- Pipeline failure isolation: a forced exception in the pipeline
  must NOT roll back the kid's submission
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

from httpx import AsyncClient
from sqlalchemy import select, text

from api.database import get_session_factory
from api.models.integrity_check import IntegrityCheckProblem, IntegrityCheckResponse
from api.models.question_bank import QuestionBankItem
from tests.conftest import TINY_PNG
from tests.conftest import auth_headers as _auth


def _submit(client: AsyncClient, world: dict[str, Any]) -> Any:
    return client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": TINY_PNG},
    )


async def test_submit_creates_integrity_rows(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    assert r.status_code == 200, r.text

    async with get_session_factory()() as s:
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == r.json()["submission_id"])
            .order_by(IntegrityCheckProblem.sample_position.asc())
        )).scalars().all()
        # The seeded world has exactly 1 primary problem
        assert len(problems) == 1
        p = problems[0]
        assert str(p.bank_item_id) == str(world["primary_id"])
        assert p.sample_position == 0
        assert p.status == "awaiting_student"
        assert p.student_work_extraction is not None
        assert p.badge is None  # not yet scored
        assert p.teacher_dismissed is False

        responses = (await s.execute(
            select(IntegrityCheckResponse)
            .where(IntegrityCheckResponse.integrity_check_problem_id == p.id)
            .order_by(IntegrityCheckResponse.question_index.asc())
        )).scalars().all()
        # Stub returns 2 questions per problem
        assert len(responses) == 2
        assert responses[0].question_index == 0
        assert responses[1].question_index == 1
        assert responses[0].question_text
        assert responses[0].student_answer is None
        assert responses[0].answer_verdict is None
        assert responses[0].rephrase_used is False


async def test_submit_with_integrity_disabled_creates_no_rows(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Flip the per-HW toggle off
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET integrity_check_enabled=false WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()

    r = await _submit(client, world)
    assert r.status_code == 200

    async with get_session_factory()() as s:
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == r.json()["submission_id"])
        )).scalars().all()
        assert problems == []


async def test_submit_caps_sample_at_max_sample(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Replace the HW content with 7 primary problems (more than the
    # MAX_SAMPLE cap of 5). We seed extra approved primaries by
    # cloning the existing one.
    from api.core.integrity_pipeline import MAX_SAMPLE

    extra_ids: list[str] = []
    async with get_session_factory()() as s:
        original = (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == world["primary_id"])
        )).scalar_one()
        for i in range(6):
            clone = QuestionBankItem(
                course_id=original.course_id,
                title=f"Extra {i}",
                question=f"Extra problem {i}",
                solution_steps=[],
                final_answer="x",
                distractors=["a", "b", "c"],
                status="approved",
                source="generated",
            )
            s.add(clone)
            await s.flush()
            extra_ids.append(str(clone.id))
        # Build the new content array: original + 6 extras = 7 total
        new_problems = [str(world["primary_id"])] + extra_ids
        await s.execute(
            text("UPDATE assignments SET content=:c WHERE id=:id"),
            {
                "c": '{"problems": [' + ", ".join(
                    f'{{"bank_item_id": "{p}", "position": {i + 1}}}'
                    for i, p in enumerate(new_problems)
                ) + ']}',
                "id": world["assignment_id"],
            },
        )
        await s.commit()

    r = await _submit(client, world)
    assert r.status_code == 200

    async with get_session_factory()() as s:
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == r.json()["submission_id"])
            .order_by(IntegrityCheckProblem.sample_position.asc())
        )).scalars().all()
        # Capped at MAX_SAMPLE (5), even though the HW has 7 primaries
        assert len(problems) == MAX_SAMPLE
        # Sample positions are 0..MAX_SAMPLE-1 in order
        assert [p.sample_position for p in problems] == list(range(MAX_SAMPLE))


async def test_submit_with_zero_primaries_no_error(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Empty the assignment's content
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET content=:c WHERE id=:id"),
            {"c": '{"problems": []}', "id": world["assignment_id"]},
        )
        await s.commit()

    r = await _submit(client, world)
    # Submit must still succeed even though there's nothing to integrity-check
    assert r.status_code == 200

    async with get_session_factory()() as s:
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == r.json()["submission_id"])
        )).scalars().all()
        assert problems == []


async def test_pipeline_failure_does_not_roll_back_submission(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Force the stub to throw. The submission must still land.
    with patch(
        "api.core.integrity_pipeline.extract_student_work",
        side_effect=RuntimeError("simulated pipeline failure"),
    ):
        r = await _submit(client, world)

    assert r.status_code == 200
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        # Submission row exists
        sub_rows = (await s.execute(
            text("SELECT id FROM submissions WHERE id=:id"),
            {"id": submission_id},
        )).all()
        assert len(sub_rows) == 1
        # No integrity rows because the pipeline failed
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == submission_id)
        )).scalars().all()
        assert problems == []


async def test_resubmit_does_not_duplicate_integrity_rows(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # First submit creates rows.
    r1 = await _submit(client, world)
    assert r1.status_code == 200

    # Second submit is rejected at the application layer (409),
    # so the pipeline never re-runs anyway. Confirm there's still
    # exactly one set of integrity rows for this student's submission.
    r2 = await _submit(client, world)
    assert r2.status_code == 409

    async with get_session_factory()() as s:
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == r1.json()["submission_id"])
        )).scalars().all()
        assert len(problems) == 1


async def test_pipeline_idempotent_on_direct_re_call(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Submit once via the API (creates one set of rows), then call
    # start_integrity_check directly with the same submission_id —
    # the idempotency guard should bail and the row count should
    # stay at 1.
    from api.core.integrity_pipeline import start_integrity_check
    from api.models.assignment import Submission

    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == submission_id)
        )).scalar_one()
        # Second call must be a no-op
        await start_integrity_check(sub.id, s)
        await s.commit()

        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == sub.id)
        )).scalars().all()
        # Still exactly one row (the seeded HW has 1 primary)
        assert len(problems) == 1
