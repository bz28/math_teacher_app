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
    """Submit the HW and wait for the background integrity pipeline."""
    response = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": TINY_PNG},
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
        assert check.overall_badge is None

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
        assert check.overall_badge == "unreadable"

        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalars().all()
        assert len(problems) == 1
        assert problems[0].status == "skipped_unreadable"
        assert problems[0].badge == "unreadable"

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
                    "badge": "likely",
                    "confidence": 0.85,
                    "reasoning": "Explained factoring with specific numbers.",
                },
                use_id="u1",
            ),
        ],
        [
            make_tool_use(
                "finish_check",
                {
                    "overall_badge": "likely",
                    "overall_confidence": 0.85,
                    "summary": "Student explained the factoring clearly.",
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
    assert body["overall_badge"] == "likely"

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
        assert check.overall_summary is not None
        assert check.overall_confidence == 0.85
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        assert problem.status == "verdict_submitted"
        assert problem.badge == "likely"
        assert problem.confidence == 0.85


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
                    "overall_badge": "likely",
                    "overall_confidence": 0.9,
                    "summary": "Trying to finish early.",
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
    assert body["overall_badge"] is None

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
                    "badge": "likely",
                    "confidence": 0.9,
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
        assert problem.badge is None

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
                    "badge": "likely",
                    "confidence": 0.9,
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
    should force-finalize with `uncertain`."""
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
    assert body["overall_badge"] == "uncertain"

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
                    "badge": "likely",
                    "confidence": 0.9,
                    "reasoning": "ok",
                },
                use_id="u1",
            ),
        ],
        [
            make_tool_use(
                "finish_check",
                {
                    "overall_badge": "likely",
                    "overall_confidence": 0.9,
                    "summary": "done",
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


async def test_teacher_dismiss_recomputes_overall_badge(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """When a teacher dismisses the only `unlikely` problem, the
    overall header badge must stop flagging the student."""
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

    # Run the happy path to completion with an `unlikely` verdict + overall.
    set_agent_script([
        [
            make_tool_use(
                "submit_problem_verdict",
                {
                    "problem_id": problem_id,
                    "badge": "unlikely",
                    "confidence": 0.9,
                    "reasoning": "Couldn't explain the factoring.",
                },
                use_id="u1",
            ),
        ],
        [
            make_tool_use(
                "finish_check",
                {
                    "overall_badge": "unlikely",
                    "overall_confidence": 0.9,
                    "summary": "student stuck.",
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
    assert detail["overall_badge"] == "unlikely"

    # Teacher dismisses the only flagged problem. The submission no
    # longer has an active unlikely verdict → overall_badge is None.
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
    assert detail2["overall_badge"] is None
    # Confidence + summary described the now-dismissed verdict, so
    # they should also be cleared.
    assert detail2["overall_confidence"] is None
    assert detail2["overall_summary"] is None


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
                    "badge": "likely",
                    "confidence": 0.9,
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
    assert r.json()["overall_badge"] == "uncertain"


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


async def test_verdict_rejects_bool_confidence(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Booleans are a Python `int` subclass. Confidence=true/false must
    be rejected by the tool-call validator."""
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
                    "badge": "likely",
                    "confidence": True,
                    "reasoning": "bool",
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
        assert any("confidence must be a number" in t.content for t in tool_results)


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
                    "badge": "likely",
                    "confidence": 0.9,
                    "reasoning": "ok",
                },
                use_id="u1",
            ),
        ],
        [
            make_tool_use(
                "finish_check",
                {
                    "overall_badge": "likely",
                    "overall_confidence": 0.9,
                    "summary": "done",
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
