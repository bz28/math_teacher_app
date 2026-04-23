"""End-to-end tests for the conversational integrity checker.

Reuses the seeded `world` fixture from conftest (teacher / student /
outsider / course / section / approved primary / published HW) so we
don't duplicate setup.

Covers the pipeline trigger, the /turn endpoint loop (including tool
calls + server-side guardrails), and the teacher detail / dismiss
endpoints.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import patch

from httpx import AsyncClient
from sqlalchemy import select, text

from api.database import get_session_factory
from api.models.integrity_check import (
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)
from api.models.question_bank import QuestionBankItem
from api.routes.school_student_practice import drain_integrity_background_tasks
from tests.conftest import (
    TINY_PNG,
    make_text,
    make_tool_use,
    set_agent_script,
)
from tests.conftest import (
    auth_headers as _auth,
)


async def _submit(client: AsyncClient, world: dict[str, Any]) -> Any:
    """Submit the HW, auto-confirm the extraction, and wait for the
    background integrity + grading pipeline.

    Under gating, integrity + grading are spawned from the confirm
    endpoint instead of fire-and-forget at submit time. Most tests
    here assume the integrity check has been initialized after
    `_submit` returns (opening turn exists, etc.), so this helper
    collapses the submit → wait-for-extraction → confirm → wait-for-
    integrity dance. Tests that need to inspect the pre-confirm
    state (no integrity check created yet) should call submit +
    drain directly instead of using this helper.
    """
    response = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": TINY_PNG},
    )
    if response.status_code != 200:
        return response
    submission_id = response.json()["submission_id"]
    # Wait for extraction background to finish persisting extraction.
    await drain_integrity_background_tasks()
    # Fire confirm to spawn integrity + grading. Idempotent if the
    # test already confirmed via its own path.
    await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
    )
    await drain_integrity_background_tasks()
    return response


# ── Pipeline trigger ────────────────────────────────────────────────


async def test_submit_creates_check_and_opening_turn(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Script the opener so the test is deterministic.
    set_agent_script([[make_text("Hi! How did you factor problem 1?")]])

    r = await _submit(client, world)
    assert r.status_code == 200, r.text
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        assert check.status == "awaiting_student"
        assert check.disposition is None

        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalars().all()
        assert len(problems) == 1
        p = problems[0]
        assert str(p.bank_item_id) == str(world["primary_id"])
        assert p.status == "pending"
        assert p.student_work_extraction is not None

        turns = (await s.execute(
            select(IntegrityConversationTurn)
            .where(IntegrityConversationTurn.integrity_check_submission_id == check.id)
            .order_by(IntegrityConversationTurn.ordinal.asc())
        )).scalars().all()
        assert len(turns) == 1
        assert turns[0].role == "agent"
        assert turns[0].content == "Hi! How did you factor problem 1?"


async def test_submit_with_integrity_disabled_creates_no_rows(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET integrity_check_enabled=false WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()

    r = await _submit(client, world)
    assert r.status_code == 200

    async with get_session_factory()() as s:
        checks = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == r.json()["submission_id"])
        )).scalars().all()
        assert checks == []


async def test_submit_caps_sample_at_max_sample(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    from api.core.integrity_pipeline import MAX_SAMPLE

    # Seed extra primary problems so the HW has more than MAX_SAMPLE.
    extra_ids: list[str] = []
    async with get_session_factory()() as s:
        original = (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == world["primary_id"])
        )).scalar_one()
        for i in range(MAX_SAMPLE + 2):
            clone = QuestionBankItem(
                course_id=original.course_id,
                originating_assignment_id=original.originating_assignment_id,
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
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == r.json()["submission_id"])
        )).scalar_one()
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalars().all()
        assert len(problems) == MAX_SAMPLE
        assert sorted(p.sample_position for p in problems) == list(range(MAX_SAMPLE))


async def test_submit_with_zero_primaries_no_error(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET content=:c WHERE id=:id"),
            {"c": '{"problems": []}', "id": world["assignment_id"]},
        )
        await s.commit()

    r = await _submit(client, world)
    assert r.status_code == 200

    async with get_session_factory()() as s:
        checks = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == r.json()["submission_id"])
        )).scalars().all()
        assert checks == []


async def test_pipeline_failure_does_not_roll_back_submission(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    with patch(
        "api.core.integrity_ai.extract_student_work",
        side_effect=RuntimeError("simulated pipeline failure"),
    ):
        r = await _submit(client, world)
    assert r.status_code == 200
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        sub_rows = (await s.execute(
            text("SELECT id FROM submissions WHERE id=:id"),
            {"id": submission_id},
        )).all()
        assert len(sub_rows) == 1
        checks = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalars().all()
        assert checks == []


async def test_unreadable_gate_skips_entire_check(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """When extraction confidence is below the threshold, the whole
    check is marked skipped_unreadable and no conversation is
    started."""
    low_conf = {"steps": [], "confidence": 0.05}
    with patch(
        "api.core.integrity_ai.extract_student_work",
        return_value=low_conf,
    ):
        r = await _submit(client, world)
    assert r.status_code == 200
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        assert check.status == "skipped_unreadable"
        # Unreadable submissions: status carries the meaning; disposition
        # stays null. Teacher dashboard surfaces skipped-unreadable as a
        # separate bucket, not as one of the four integrity dispositions.
        assert check.disposition is None

        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalars().all()
        assert len(problems) == 1
        assert problems[0].status == "skipped_unreadable"
        assert problems[0].rubric is None

        turns = (await s.execute(
            select(IntegrityConversationTurn)
            .where(IntegrityConversationTurn.integrity_check_submission_id == check.id)
        )).scalars().all()
        assert turns == []


async def test_pipeline_idempotent_on_direct_re_call(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    from api.core.integrity_pipeline import start_integrity_check
    from api.models.assignment import Submission

    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == submission_id)
        )).scalar_one()
        await start_integrity_check(sub.id, s)
        await s.commit()

        checks = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == sub.id)
        )).scalars().all()
        assert len(checks) == 1


# ── Student state + turn endpoints ──────────────────────────────────


async def test_get_state_after_submit_returns_awaiting_student(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    set_agent_script([[make_text("Hi there!")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    r = await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["overall_status"] == "awaiting_student"
    assert len(body["problems"]) == 1
    assert body["problems"][0]["status"] == "pending"
    assert len(body["transcript"]) == 1
    assert body["transcript"][0]["role"] == "agent"
    assert body["transcript"][0]["content"] == "Hi there!"


async def test_get_state_returns_extracting_before_pipeline_writes(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Before the pipeline has created any rows, the endpoint should
    report "extracting" when integrity is enabled."""
    from api.models.assignment import Submission
    async with get_session_factory()() as s:
        sub = Submission(
            assignment_id=world["assignment_id"],
            student_id=world["student_id"],
            section_id=(await s.execute(
                text("SELECT id FROM sections LIMIT 1"),
            )).scalar_one(),
            status="submitted",
            image_data=TINY_PNG,
            final_answers=None,
            is_late=False,
        )
        s.add(sub)
        await s.commit()
        submission_id = str(sub.id)

    r = await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["overall_status"] == "extracting"
    assert body["problems"] == []
    assert body["transcript"] == []


async def test_get_state_returns_no_check_when_disabled(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET integrity_check_enabled=false WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()

    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    r = await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["overall_status"] == "no_check"


async def test_get_state_404_for_outsider(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    r = await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 404


async def test_turn_rejects_short_messages(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    set_agent_script([[make_text("Opener")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={"message": "x"},
    )
    assert r.status_code == 400


async def test_turn_happy_path_verdict_then_finish(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Opener, then the student sends one message. Agent responds with
    # submit_problem_verdict; server accepts; agent calls
    # finish_check; server accepts; conversation goes to "complete".
    set_agent_script([
        [make_text("Opener: walk me through factoring problem 1.")],
    ])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    # Grab the problem_id for the agent script.
    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)

    # Script: first agent call (after student turn) returns a verdict.
    # Second call (after tool_result) returns finish_check.
    set_agent_script([
        [
            make_text("Nice — sounds like you get it."),
            make_tool_use(
                "submit_problem_verdict",
                {
                    "problem_id": problem_id,
                    "rubric": {
                        "paraphrase_originality": "high",
                        "causal_fluency": "high",
                    },
                    "reasoning": "Explained factoring with specific numbers.",
                },
                use_id="u1",
            ),
        ],
        [
            make_tool_use(
                "finish_check",
                {
                    "disposition": "pass",
                    "summary": "Student explained the factoring clearly.",
                    "inline_variant_result": "not_applicable",
                },
                use_id="u2",
            ),
        ],
    ])

    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={
            "message": "I looked for two numbers that multiply to 6 and add to -5.",
            "seconds_on_turn": 12,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["overall_status"] == "complete"
    assert body["disposition"] == "pass"

    # Transcript visible to the student: opener, their own message,
    # the agent's acknowledgement, and the closing message. Tool call
    # rows must not leak into the student view.
    roles = [t["role"] for t in body["transcript"]]
    assert "tool_call" not in roles
    assert "tool_result" not in roles

    # DB state: problem verdict_submitted, check complete.
    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        assert check.status == "complete"
        assert check.disposition == "pass"
        assert check.overall_summary is not None
        assert check.inline_variant_result == "not_applicable"
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        assert problem.status == "verdict_submitted"
        assert problem.rubric is not None
        assert problem.rubric["paraphrase_originality"] == "high"
        assert problem.rubric["causal_fluency"] == "high"


async def test_turn_finish_before_all_verdicts_rejected(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """If the agent calls finish_check before every sampled problem
    has a verdict, the server rejects with a tool_result and the
    status stays in_progress."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    set_agent_script([
        [
            make_tool_use(
                "finish_check",
                {
                    "disposition": "pass",
                    "summary": "Trying to finish early.",
                    "inline_variant_result": "not_applicable",
                },
                use_id="u1",
            ),
        ],
        # After the rejection, the agent falls back to plain text.
        [make_text("Let me ask a bit more first.")],
    ])

    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={"message": "Hmm, I'm not sure about step 2."},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["overall_status"] == "in_progress"
    assert body["disposition"] is None

    # The rejection reason should be recorded on the hidden transcript.
    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        tool_results = (await s.execute(
            select(IntegrityConversationTurn)
            .where(
                IntegrityConversationTurn.integrity_check_submission_id == check.id,
                IntegrityConversationTurn.role == "tool_result",
            )
        )).scalars().all()
        assert tool_results
        assert any("still missing" in t.content for t in tool_results)


async def test_turn_verdict_floor_rejects_when_no_student_turn_yet(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """If the agent somehow tries to verdict on a problem before any
    student turn has landed on it, the server rejects it. We simulate
    this by patching VERDICT_STUDENT_TURN_FLOOR higher than the count
    the student has accumulated on this turn."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)

    set_agent_script([
        [
            make_tool_use(
                "submit_problem_verdict",
                {
                    "problem_id": problem_id,
                    "rubric": {
                        "paraphrase_originality": "high",
                        "causal_fluency": "high",
                    },
                    "reasoning": "Premature.",
                },
                use_id="u1",
            ),
        ],
        [make_text("Let me actually ask.")],
    ])

    # Bump the floor to 2 so this student turn (which brings count to
    # 1) isn't enough to allow a verdict.
    with patch(
        "api.core.integrity_pipeline.VERDICT_STUDENT_TURN_FLOOR", 2,
    ):
        r = await client.post(
            f"/v1/school/student/integrity/submissions/{submission_id}/turn",
            headers=_auth(world["student_token"]),
            json={"message": "First message from the student."},
        )
    assert r.status_code == 200

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        assert problem.status == "pending"
        assert problem.rubric is None

        tool_results = (await s.execute(
            select(IntegrityConversationTurn)
            .where(
                IntegrityConversationTurn.integrity_check_submission_id == check.id,
                IntegrityConversationTurn.role == "tool_result",
            )
        )).scalars().all()
        assert any("need at least" in t.content for t in tool_results)


async def test_turn_verdict_rejects_invalid_problem_id(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    bogus_id = str(uuid.uuid4())
    set_agent_script([
        [
            make_tool_use(
                "submit_problem_verdict",
                {
                    "problem_id": bogus_id,
                    "rubric": {
                        "paraphrase_originality": "high",
                        "causal_fluency": "high",
                    },
                    "reasoning": "bogus",
                },
                use_id="u1",
            ),
        ],
        [make_text("Recovering.")],
    ])

    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={"message": "Hello, this is a real message."},
    )
    assert r.status_code == 200

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        tool_results = (await s.execute(
            select(IntegrityConversationTurn)
            .where(
                IntegrityConversationTurn.integrity_check_submission_id == check.id,
                IntegrityConversationTurn.role == "tool_result",
            )
        )).scalars().all()
        assert any("does not match" in t.content for t in tool_results)


async def test_turn_hard_cap_force_finalizes(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Send enough student turns to hit MAX_STUDENT_TURNS; the check
    should force-finalize with a null disposition (teacher reviews —
    agent ran out of time, we don't pretend to have judged the student)."""
    from api.core.integrity_pipeline import MAX_STUDENT_TURNS

    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    for i in range(MAX_STUDENT_TURNS):
        # Empty agent script on each iteration → default text reply.
        set_agent_script([])
        r = await client.post(
            f"/v1/school/student/integrity/submissions/{submission_id}/turn",
            headers=_auth(world["student_token"]),
            json={"message": f"Turn number {i + 1} from the student here."},
        )
        assert r.status_code == 200

    body = r.json()
    assert body["overall_status"] == "complete"
    assert body["disposition"] is None

    # An 11th turn attempt is now rejected.
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={"message": "One more message after the cap."},
    )
    assert r.status_code == 409


async def test_turn_409_when_complete(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Once the check is complete, /turn returns 409."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)

    set_agent_script([
        [
            make_tool_use(
                "submit_problem_verdict",
                {
                    "problem_id": problem_id,
                    "rubric": {
                        "paraphrase_originality": "high",
                        "causal_fluency": "high",
                    },
                    "reasoning": "ok",
                },
                use_id="u1",
            ),
        ],
        [
            make_tool_use(
                "finish_check",
                {
                    "disposition": "pass",
                    "summary": "done",
                    "inline_variant_result": "not_applicable",
                },
                use_id="u2",
            ),
        ],
    ])

    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={"message": "My reasoning on this problem."},
    )
    assert r.status_code == 200
    assert r.json()["overall_status"] == "complete"

    # Another turn → 409.
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={"message": "Can I say something else?"},
    )
    assert r.status_code == 409


# ── Teacher endpoints ──────────────────────────────────────────────


async def test_teacher_get_detail_includes_extraction_and_transcript(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    r = await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["overall_status"] == "awaiting_student"
    assert len(body["problems"]) == 1
    p = body["problems"][0]
    assert p["student_work_extraction"] is not None
    assert p["question"]  # surfaced alongside extraction for context
    assert len(body["transcript"]) == 1
    assert body["transcript"][0]["role"] == "agent"


async def test_teacher_get_integrity_403_for_other_teacher(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        from api.core.auth import create_access_token, hash_password
        from api.models.user import User
        other = User(
            email=f"other_t_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12,
            role="teacher",
            name="OT",
        )
        s.add(other)
        await s.commit()
        other_token = create_access_token(str(other.id), "teacher")

    r = await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(other_token),
    )
    assert r.status_code == 403


async def test_teacher_dismiss_marks_problem(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    detail = (await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )).json()
    problem_id = detail["problems"][0]["problem_id"]

    r = await client.post(
        f"/v1/teacher/integrity/submissions/{submission_id}/dismiss",
        headers=_auth(world["teacher_token"]),
        json={"problem_id": problem_id, "reason": "AI question was off"},
    )
    assert r.status_code == 204

    detail2 = (await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )).json()
    p = detail2["problems"][0]
    assert p["teacher_dismissed"] is True
    assert p["teacher_dismissal_reason"] == "AI question was off"
    assert p["status"] == "dismissed"

    # Re-dismiss with a new reason updates the reason.
    r = await client.post(
        f"/v1/teacher/integrity/submissions/{submission_id}/dismiss",
        headers=_auth(world["teacher_token"]),
        json={"problem_id": problem_id, "reason": "revised reason"},
    )
    assert r.status_code == 204
    detail3 = (await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )).json()
    assert detail3["problems"][0]["teacher_dismissal_reason"] == "revised reason"


async def test_teacher_dismiss_keeps_disposition_frozen(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Session-level disposition is the agent's holistic judgment and
    is NOT recomputed when a teacher dismisses a problem. The teacher
    sees the original disposition alongside the dismissed-problem
    indicator and interprets both."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)

    # Run the happy path to a flag_for_review disposition.
    set_agent_script([
        [
            make_tool_use(
                "submit_problem_verdict",
                {
                    "problem_id": problem_id,
                    "rubric": {
                        "paraphrase_originality": "low",
                        "causal_fluency": "low",
                    },
                    "reasoning": "Couldn't explain the factoring.",
                },
                use_id="u1",
            ),
        ],
        [
            make_tool_use(
                "finish_check",
                {
                    "disposition": "flag_for_review",
                    "summary": "Correct work, blank verbal.",
                    "inline_variant_result": "not_applicable",
                },
                use_id="u2",
            ),
        ],
    ])
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={"message": "I think I factored it wrong."},
    )
    assert r.status_code == 200
    detail = (await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )).json()
    assert detail["disposition"] == "flag_for_review"

    # Teacher dismisses the flagged problem. Disposition stays frozen —
    # it reflects the agent's holistic judgment, not a derivative of
    # per-problem state. The teacher UI can show "disposition +
    # dismissed problem" together.
    r = await client.post(
        f"/v1/teacher/integrity/submissions/{submission_id}/dismiss",
        headers=_auth(world["teacher_token"]),
        json={"problem_id": problem_id, "reason": "irrelevant"},
    )
    assert r.status_code == 204

    detail2 = (await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )).json()
    assert detail2["disposition"] == "flag_for_review"
    assert detail2["overall_summary"] == "Correct work, blank verbal."
    assert detail2["problems"][0]["teacher_dismissed"] is True


async def test_verdict_rejected_on_teacher_dismissed_problem(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Teacher's dismiss outranks the agent. A subsequent agent
    verdict on the same problem is rejected with a tool_result."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)

    # Teacher dismisses mid-conversation.
    r = await client.post(
        f"/v1/teacher/integrity/submissions/{submission_id}/dismiss",
        headers=_auth(world["teacher_token"]),
        json={"problem_id": problem_id, "reason": "ignore"},
    )
    assert r.status_code == 204

    # Agent now tries to submit a verdict on the same problem.
    set_agent_script([
        [
            make_tool_use(
                "submit_problem_verdict",
                {
                    "problem_id": problem_id,
                    "rubric": {
                        "paraphrase_originality": "high",
                        "causal_fluency": "high",
                    },
                    "reasoning": "late verdict",
                },
                use_id="u1",
            ),
        ],
        [make_text("Moving on.")],
    ])
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={"message": "Here's my explanation."},
    )
    assert r.status_code == 200

    async with get_session_factory()() as s:
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.id == uuid.UUID(problem_id))
        )).scalar_one()
        # Dismissed status preserved; agent did NOT overwrite.
        assert problem.status == "dismissed"
        assert problem.teacher_dismissed is True
        tool_results = (await s.execute(
            select(IntegrityConversationTurn)
            .where(
                IntegrityConversationTurn.role == "tool_result",
            )
        )).scalars().all()
        assert any("dismissed" in t.content for t in tool_results)


async def test_turn_force_finalizes_on_agent_failure_at_cap(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """If the agent call fails on the student's final allowed turn,
    the check must still force-finalize so the teacher sees a
    resolved state instead of a permanently `in_progress` row."""
    from api.core.integrity_pipeline import MAX_STUDENT_TURNS

    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    # Burn MAX_STUDENT_TURNS - 1 successful student turns with the
    # default script (empty → default text reply).
    for i in range(MAX_STUDENT_TURNS - 1):
        set_agent_script([])
        r = await client.post(
            f"/v1/school/student/integrity/submissions/{submission_id}/turn",
            headers=_auth(world["student_token"]),
            json={"message": f"Turn number {i + 1} from the student."},
        )
        assert r.status_code == 200

    # 10th turn: make the agent call raise. Check must still complete.
    with patch(
        "api.core.integrity_pipeline.run_agent_turn",
        side_effect=RuntimeError("simulated LLM failure"),
    ):
        r = await client.post(
            f"/v1/school/student/integrity/submissions/{submission_id}/turn",
            headers=_auth(world["student_token"]),
            json={"message": "Tenth turn that triggers the failure."},
        )
    assert r.status_code == 200
    assert r.json()["overall_status"] == "complete"
    # Turn cap without a conclusion → null disposition (teacher reviews).
    assert r.json()["disposition"] is None


async def test_turn_request_rejects_out_of_range_seconds(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """`seconds_on_turn` is clamped so a tampered client can't land
    negative or absurd values in the teacher transcript — but the
    upper bound must be generous enough to cover a student who
    legitimately walks away and comes back hours later."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    # Tampered values are rejected.
    for bad in (-1, 10_000_000):
        r = await client.post(
            f"/v1/school/student/integrity/submissions/{submission_id}/turn",
            headers=_auth(world["student_token"]),
            json={
                "message": "This is a valid message.",
                "seconds_on_turn": bad,
            },
        )
        assert r.status_code == 422, r.text

    # A long legitimate pause (90 min) is accepted.
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={
            "message": "Back from lunch. Here's my actual answer.",
            "seconds_on_turn": 5400,
        },
    )
    assert r.status_code == 200, r.text


async def test_verdict_rejects_invalid_rubric(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Rubric validation must reject invalid enum values. Specifically,
    paraphrase_originality/causal_fluency only accept low/mid/high —
    not 'not_probed' (which is valid for the optional dimensions)."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)

    set_agent_script([
        [
            make_tool_use(
                "submit_problem_verdict",
                {
                    "problem_id": problem_id,
                    # 'not_probed' is NOT a valid value for
                    # paraphrase_originality — that dimension is scored
                    # from the open walkthrough so it's always observed.
                    "rubric": {
                        "paraphrase_originality": "not_probed",
                        "causal_fluency": "high",
                    },
                    "reasoning": "bad enum",
                },
                use_id="u1",
            ),
        ],
        [make_text("Fine, moving on.")],
    ])
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={"message": "My first real message."},
    )
    assert r.status_code == 200

    async with get_session_factory()() as s:
        tool_results = (await s.execute(
            select(IntegrityConversationTurn)
            .where(IntegrityConversationTurn.role == "tool_result")
        )).scalars().all()
        assert any(
            "paraphrase_originality" in t.content for t in tool_results
        )


# ── Inline variant disambiguator ───────────────────────────────────


async def test_generate_variant_flips_flag_and_echoes_problem(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Happy path for the disambiguator tool: agent calls
    generate_variant, pipeline generates a similar problem via
    practice.generate_similar_questions, flips inline_variant_used,
    and returns the variant text in the tool_result for the agent to
    surface on the next turn."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)
        assert check.inline_variant_used is False

    variant_text = "Factor 2x^2 + 5x - 3"
    with patch(
        "api.core.practice.generate_similar_questions",
        return_value=[variant_text],
    ):
        set_agent_script([
            [
                make_tool_use(
                    "generate_variant",
                    {"problem_id": problem_id},
                    use_id="uv1",
                ),
            ],
            # After the tool_result, agent falls back to plain text.
            [make_text("Here's a similar one — how would you approach it?")],
        ])
        r = await client.post(
            f"/v1/school/student/integrity/submissions/{submission_id}/turn",
            headers=_auth(world["student_token"]),
            json={"message": "I don't really know how to explain it."},
        )
        assert r.status_code == 200

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        assert check.inline_variant_used is True

        tool_results = (await s.execute(
            select(IntegrityConversationTurn)
            .where(
                IntegrityConversationTurn.integrity_check_submission_id == check.id,
                IntegrityConversationTurn.role == "tool_result",
            )
        )).scalars().all()
        assert any(variant_text in t.content for t in tool_results)

    # Student-facing transcript flags the agent turn that presents the
    # variant with is_variant_probe=True so the frontend can render it
    # as a distinguished "quick practice" card. Every other agent turn
    # is false.
    state = (await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["student_token"]),
    )).json()
    agent_turns = [t for t in state["transcript"] if t["role"] == "agent"]
    # Opener, plus the variant-presenter turn after the tool call.
    assert len(agent_turns) >= 2
    assert agent_turns[0]["is_variant_probe"] is False
    assert agent_turns[1]["is_variant_probe"] is True


async def test_generate_variant_rejects_second_call(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Enforced once-per-session cap. Second call in the same session
    returns a tool_result rejection without flipping or regenerating."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)

    with patch(
        "api.core.practice.generate_similar_questions",
        return_value=["Variant text."],
    ) as gen_mock:
        # Turn 1: first call succeeds.
        set_agent_script([
            [
                make_tool_use(
                    "generate_variant",
                    {"problem_id": problem_id},
                    use_id="uv1",
                ),
            ],
            [make_text("First variant.")],
        ])
        r = await client.post(
            f"/v1/school/student/integrity/submissions/{submission_id}/turn",
            headers=_auth(world["student_token"]),
            json={"message": "I'm not sure how to explain that one."},
        )
        assert r.status_code == 200

        # Turn 2: second call in the same session — must be rejected.
        set_agent_script([
            [
                make_tool_use(
                    "generate_variant",
                    {"problem_id": problem_id},
                    use_id="uv2",
                ),
            ],
            [make_text("Moving on.")],
        ])
        r = await client.post(
            f"/v1/school/student/integrity/submissions/{submission_id}/turn",
            headers=_auth(world["student_token"]),
            json={"message": "Another response from the student."},
        )
        assert r.status_code == 200

    # The regenerator was only invoked once despite two agent calls.
    assert gen_mock.call_count == 1

    async with get_session_factory()() as s:
        tool_results = (await s.execute(
            select(IntegrityConversationTurn)
            .where(IntegrityConversationTurn.role == "tool_result")
        )).scalars().all()
        assert any(
            "can only be called once per session" in t.content
            for t in tool_results
        )

    # is_variant_probe: only the FIRST (successful) variant arms the
    # flag on the following agent text. The SECOND call was rejected,
    # so the agent's "Moving on." recovery text must NOT be flagged —
    # otherwise the student would see an empty "Quick practice" card.
    state = (await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["student_token"]),
    )).json()
    agent_texts = [
        t["content"] for t in state["transcript"]
        if t["role"] == "agent"
    ]
    variant_flags = [
        t["is_variant_probe"] for t in state["transcript"]
        if t["role"] == "agent"
    ]
    assert "First variant." in agent_texts
    assert "Moving on." in agent_texts
    assert variant_flags[agent_texts.index("First variant.")] is True
    assert variant_flags[agent_texts.index("Moving on.")] is False


async def test_generate_variant_rejects_before_student_turn(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Agent can't call generate_variant before the student has sent
    at least one message — same floor as submit_problem_verdict."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)

    with patch(
        "api.core.practice.generate_similar_questions",
        return_value=["Variant text."],
    ) as gen_mock:
        # Set the floor to 2 so this first student turn isn't enough.
        set_agent_script([
            [
                make_tool_use(
                    "generate_variant",
                    {"problem_id": problem_id},
                    use_id="uv1",
                ),
            ],
            [make_text("Recovering.")],
        ])
        with patch(
            "api.core.integrity_pipeline.VERDICT_STUDENT_TURN_FLOOR", 2,
        ):
            r = await client.post(
                f"/v1/school/student/integrity/submissions/{submission_id}/turn",
                headers=_auth(world["student_token"]),
                json={"message": "A first message from the student."},
            )
        assert r.status_code == 200

    # Rejected before the generator was ever called.
    assert gen_mock.call_count == 0

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        assert check.inline_variant_used is False

        tool_results = (await s.execute(
            select(IntegrityConversationTurn)
            .where(IntegrityConversationTurn.role == "tool_result")
        )).scalars().all()
        assert any(
            "need at least" in t.content and "student turn" in t.content
            for t in tool_results
        )


async def test_generate_variant_rejects_unknown_problem_id(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """problem_id must belong to the sampled problems for this
    conversation. Bogus UUIDs get rejected; inline_variant_used stays
    false."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    bogus = str(uuid.uuid4())
    with patch(
        "api.core.practice.generate_similar_questions",
        return_value=["Variant text."],
    ) as gen_mock:
        set_agent_script([
            [
                make_tool_use(
                    "generate_variant",
                    {"problem_id": bogus},
                    use_id="uv1",
                ),
            ],
            [make_text("Recovering.")],
        ])
        r = await client.post(
            f"/v1/school/student/integrity/submissions/{submission_id}/turn",
            headers=_auth(world["student_token"]),
            json={"message": "Here is a real student message."},
        )
        assert r.status_code == 200

    # Generator was never invoked because problem_id failed validation.
    assert gen_mock.call_count == 0

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        assert check.inline_variant_used is False

        tool_results = (await s.execute(
            select(IntegrityConversationTurn)
            .where(IntegrityConversationTurn.role == "tool_result")
        )).scalars().all()
        assert any("does not match" in t.content for t in tool_results)


async def test_generate_variant_handles_llm_failure_gracefully(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """When the similar-question generator raises, the tool_result
    reports the failure and the flag stays false so the agent can
    proceed without the variant — not crash the whole loop."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)

    with patch(
        "api.core.practice.generate_similar_questions",
        side_effect=RuntimeError("simulated LLM failure"),
    ):
        set_agent_script([
            [
                make_tool_use(
                    "generate_variant",
                    {"problem_id": problem_id},
                    use_id="uv1",
                ),
            ],
            [make_text("Moving on without the variant.")],
        ])
        r = await client.post(
            f"/v1/school/student/integrity/submissions/{submission_id}/turn",
            headers=_auth(world["student_token"]),
            json={"message": "I can't explain it very well."},
        )
        assert r.status_code == 200

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        # Generator failed → flag stays false so the agent could
        # legitimately try again in a later session if it wanted.
        assert check.inline_variant_used is False

        tool_results = (await s.execute(
            select(IntegrityConversationTurn)
            .where(IntegrityConversationTurn.role == "tool_result")
        )).scalars().all()
        assert any(
            "variant generation failed" in t.content for t in tool_results
        )


async def test_finish_check_rejects_variant_result_without_variant_used(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Anti-spoofing rule: finish_check rejects a concrete
    inline_variant_result (anything other than not_applicable) when
    generate_variant was never called in the session. Guards against
    a model hallucinating a variant outcome."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)

    # Agent submits a verdict, then tries to finish with a specific
    # variant_result even though generate_variant was never called.
    set_agent_script([
        [
            make_tool_use(
                "submit_problem_verdict",
                {
                    "problem_id": problem_id,
                    "rubric": {
                        "paraphrase_originality": "high",
                        "causal_fluency": "high",
                    },
                    "reasoning": "Explained clearly.",
                },
                use_id="uv1",
            ),
        ],
        [
            make_tool_use(
                "finish_check",
                {
                    "disposition": "pass",
                    "summary": "Good.",
                    "inline_variant_result": "specific_approach",
                },
                use_id="uv2",
            ),
        ],
        # After rejection, fall back to plain text.
        [make_text("Wrapping up.")],
    ])
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={"message": "Here is my explanation of the approach."},
    )
    assert r.status_code == 200

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        # Rejection should have kept the check non-complete on this turn.
        assert check.status != "complete"
        assert check.disposition is None
        assert check.inline_variant_result is None

        tool_results = (await s.execute(
            select(IntegrityConversationTurn)
            .where(IntegrityConversationTurn.role == "tool_result")
        )).scalars().all()
        assert any(
            "generate_variant was never called" in t.content
            for t in tool_results
        )


async def test_finish_check_rejects_when_agent_asked_question_same_turn(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Guard against the "ask a question and finalize in one breath"
    bug. When the agent's response text ends with "?", finish_check
    must be rejected so the check doesn't close with an outstanding
    question the student never got to answer."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)

    # Agent emits a follow-up question + verdict + finish_check all
    # in one response. Guard should reject the finalize.
    set_agent_script([
        [
            make_text("And where did the 2 and 12 come from?"),
            make_tool_use(
                "submit_problem_verdict",
                {
                    "problem_id": problem_id,
                    "rubric": {
                        "paraphrase_originality": "high",
                        "causal_fluency": "high",
                    },
                    "reasoning": "Good signal.",
                },
                use_id="uv1",
            ),
            make_tool_use(
                "finish_check",
                {
                    "disposition": "pass",
                    "summary": "Looked good.",
                    "inline_variant_result": "not_applicable",
                },
                use_id="uf1",
            ),
        ],
        # After rejection, agent falls back to plain text (still
        # waiting on the student's answer).
        [make_text("Sorry — take your time.")],
    ])
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={"message": "I did 2+12 but not sure why."},
    )
    assert r.status_code == 200

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        # Check must NOT be complete — finalize was rejected.
        assert check.status != "complete"
        assert check.disposition is None

        tool_results = (await s.execute(
            select(IntegrityConversationTurn)
            .where(IntegrityConversationTurn.role == "tool_result")
        )).scalars().all()
        assert any(
            "outstanding question" in t.content for t in tool_results
        )


# ── Telemetry ──────────────────────────────────────────────────────


async def test_turn_persists_telemetry_payload(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Client-captured telemetry (focus-blur, paste, cadence) is
    persisted as-is on the student turn row. Teacher-facing evidence;
    student never sees it back on the state endpoint."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    telemetry_payload = {
        "focus_blur_events": [
            {"at": "2026-04-22T18:00:00Z", "duration_ms": 4200},
        ],
        "paste_events": [
            {"at": "2026-04-22T18:00:05Z", "byte_count": 42},
        ],
        "typing_cadence": {
            "total_ms": 42000,
            "pauses_over_3s": 2,
            "edits": 5,
        },
        "need_more_time_used": False,
        "device_type": "desktop",
    }

    set_agent_script([[make_text("Thanks for explaining.")]])
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={
            "message": "I factored out the 2 first.",
            "seconds_on_turn": 42,
            "telemetry": telemetry_payload,
        },
    )
    assert r.status_code == 200

    # Student-facing state must NOT echo telemetry back to the student.
    body = r.json()
    assert "telemetry" not in body
    for t in body["transcript"]:
        assert "telemetry" not in t

    # Telemetry lands on the student turn row as-is.
    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        student_turns = (await s.execute(
            select(IntegrityConversationTurn)
            .where(
                IntegrityConversationTurn.integrity_check_submission_id == check.id,
                IntegrityConversationTurn.role == "student",
            )
        )).scalars().all()
        assert len(student_turns) == 1
        assert student_turns[0].telemetry == telemetry_payload


async def test_turn_rejects_oversized_telemetry(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Validation caps keep a tampered client from landing absurd
    values in the teacher record: oversized per-event values and
    oversized arrays both get rejected at the endpoint."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    # duration_ms above 24h → rejected.
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={
            "message": "Real message here.",
            "telemetry": {
                "focus_blur_events": [
                    {"at": "2026-04-22T18:00:00Z", "duration_ms": 999_999_999_999},
                ],
                "paste_events": [],
                "need_more_time_used": False,
            },
        },
    )
    assert r.status_code == 422

    # >256 focus_blur_events in a single turn → rejected.
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={
            "message": "Another real message.",
            "telemetry": {
                "focus_blur_events": [
                    {"at": "2026-04-22T18:00:00Z", "duration_ms": 100}
                    for _ in range(300)
                ],
                "paste_events": [],
                "need_more_time_used": False,
            },
        },
    )
    assert r.status_code == 422


async def test_turn_without_telemetry_still_works(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Telemetry is optional — older clients that don't send it must
    still complete turns, and the column is left null."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    set_agent_script([[make_text("Ok.")]])
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={
            "message": "Here's my first message.",
            "seconds_on_turn": 10,
        },
    )
    assert r.status_code == 200

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        student_turns = (await s.execute(
            select(IntegrityConversationTurn)
            .where(
                IntegrityConversationTurn.integrity_check_submission_id == check.id,
                IntegrityConversationTurn.role == "student",
            )
        )).scalars().all()
        assert len(student_turns) == 1
        assert student_turns[0].telemetry is None


# ── Extraction flag ────────────────────────────────────────────────


async def test_flag_extraction_sets_flag_idempotent_and_terminal_409(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """`flag-extraction` raises the student's "reader got it wrong"
    signal, is idempotent on re-flag, and 409s once the check has
    gone terminal."""
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    # Initial state shows the flag is False.
    state = (await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["student_token"]),
    )).json()
    assert state["student_flagged_extraction"] is False

    # Raise the flag.
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/flag-extraction",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    assert r.json()["student_flagged_extraction"] is True

    # Idempotent — second call is a no-op, still returns True.
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/flag-extraction",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    assert r.json()["student_flagged_extraction"] is True

    # Teacher detail surfaces the flag too.
    teacher_detail = (await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )).json()
    assert teacher_detail["student_flagged_extraction"] is True

    # Drive the check to terminal state and verify the flag endpoint
    # 409s — once the agent has finalized, the flag can't change the
    # picture.
    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)

    set_agent_script([
        [
            make_tool_use(
                "submit_problem_verdict",
                {
                    "problem_id": problem_id,
                    "rubric": {
                        "paraphrase_originality": "high",
                        "causal_fluency": "high",
                    },
                    "reasoning": "ok",
                },
                use_id="u1",
            ),
        ],
        [
            make_tool_use(
                "finish_check",
                {
                    "disposition": "pass",
                    "summary": "done",
                    "inline_variant_result": "not_applicable",
                },
                use_id="u2",
            ),
        ],
    ])
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=_auth(world["student_token"]),
        json={"message": "My reasoning on this problem."},
    )
    assert r.status_code == 200
    assert r.json()["overall_status"] == "complete"

    # Flag endpoint now rejects with 409.
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/flag-extraction",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 409


async def test_flag_extraction_404_for_outsider(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    set_agent_script([[make_text("Opener.")]])
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/flag-extraction",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 404


async def test_flag_extraction_404_when_no_check_exists(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A submission without a running integrity check 404s on flag —
    there's nothing to flag."""
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET integrity_check_enabled=false WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()

    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/flag-extraction",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404
