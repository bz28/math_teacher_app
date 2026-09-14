"""The two admin reads behind the dashboard's blind-spot surfaces.

- `GET /admin/blocked-submissions` groups `submission.rejected` rows by
  student × homework so eleven log lines read as one person.
- `GET /admin/submissions/{id}/case` joins, per problem, the AI grade
  with the understanding-check outcome, and returns the check's
  transcript with the agent's tool calls in place — the moments it
  decided.

Both are driven end to end: the real submit → confirm → chat pipeline
(agent scripted) produces the integrity rows; the grade is seeded the
way the grader writes it.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.auth import create_access_token, hash_password
from api.core.submission_rejections import record_submission_rejection
from api.database import get_session_factory
from api.models.assignment import SubmissionGrade
from api.models.integrity_check import IntegrityCheckProblem, IntegrityCheckSubmission
from api.models.student_record_access_log import StudentRecordAccessLog
from api.models.user import User
from api.routes.school_student_practice import drain_integrity_background_tasks
from tests.conftest import TINY_PNG, auth_headers, make_text, make_tool_use, set_agent_script


@pytest.fixture
async def admin_token() -> str:
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
            grade_level=99, role="admin", name="Admin",
        )
        s.add(admin)
        await s.commit()
        return create_access_token(str(admin.id), "admin")


async def _submit_and_confirm(client: AsyncClient, world: dict[str, Any]) -> str:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=auth_headers(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    assert r.status_code == 200, r.text
    submission_id: str = r.json()["submission_id"]
    await drain_integrity_background_tasks()
    await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=auth_headers(world["student_token"]),
    )
    await drain_integrity_background_tasks()
    return submission_id


# ── Blocked submissions ─────────────────────────────────────────────

async def test_blocked_submissions_groups_by_student_and_homework(
    client: AsyncClient, world: dict[str, Any], admin_token: str,
) -> None:
    hw = world["assignment_id"]
    for size in (9_000_000, 11_600_000, 10_200_000):
        await record_submission_rejection(
            actor_user_id=world["student_id"], assignment_id=hw,
            reason="upload_too_large", request_bytes=size,
        )
    await record_submission_rejection(
        actor_user_id=world["student_id"], assignment_id=hw,
        reason="file_invalid", request_bytes=40_000, decoded_bytes=0,
    )
    # A second student, one attempt; an unattributed pre-auth refusal.
    await record_submission_rejection(
        actor_user_id=world["outsider_id"], assignment_id=hw,
        reason="upload_too_large", request_bytes=26_100_000,
    )
    await record_submission_rejection(
        actor_user_id=None, assignment_id=hw,
        reason="upload_too_large", request_bytes=12_000_000,
    )

    r = await client.get("/v1/admin/blocked-submissions", headers=auth_headers(admin_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["days"] == 7

    assert [s["student_id"] for s in body["students"]] == [
        str(world["student_id"]), str(world["outsider_id"]),
    ]
    top = body["students"][0]
    assert top["attempts"] == 4
    assert top["largest_request_bytes"] == 11_600_000
    assert top["reasons"] == {"upload_too_large": 3, "file_invalid": 1}
    assert top["top_reason"] == "upload_too_large"
    assert top["assignment_id"] == str(hw)
    assert top["assignment_title"] == "HW 1"
    assert top["course_name"] == "Algebra 1"
    assert top["submitted_since"] is False
    assert top["first_at"] <= top["last_at"]

    assert len(body["unattributed"]) == 1
    assert body["unattributed"][0]["attempts"] == 1
    assert body["unattributed"][0]["assignment_title"] == "HW 1"


async def test_blocked_submissions_marks_a_student_who_got_through(
    client: AsyncClient, world: dict[str, Any], admin_token: str,
) -> None:
    await record_submission_rejection(
        actor_user_id=world["student_id"], assignment_id=world["assignment_id"],
        reason="upload_too_large", request_bytes=11_600_000,
    )
    set_agent_script([[make_text("Walk me through problem 1.")]])
    await _submit_and_confirm(client, world)

    r = await client.get("/v1/admin/blocked-submissions", headers=auth_headers(admin_token))
    row = r.json()["students"][0]
    assert row["attempts"] == 1
    # The incident stays on the board, marked resolved — the student
    # eventually turned the homework in.
    assert row["submitted_since"] is True


async def test_blocked_submissions_excludes_preview_students_and_old_rows(
    client: AsyncClient, world: dict[str, Any], admin_token: str,
) -> None:
    async with get_session_factory()() as s:
        preview = User(
            email=f"preview_{uuid.uuid4().hex[:6]}@t.com", password_hash="x",
            grade_level=8, role="student", name="Preview", is_preview=True,
        )
        s.add(preview)
        await s.commit()
        preview_id = preview.id
    await record_submission_rejection(
        actor_user_id=preview_id, assignment_id=world["assignment_id"],
        reason="upload_too_large", request_bytes=11_600_000,
    )
    r = await client.get("/v1/admin/blocked-submissions", headers=auth_headers(admin_token))
    assert r.json()["students"] == []
    assert r.json()["unattributed"] == []

    # The window is honoured: nothing landed inside the last day.
    await record_submission_rejection(
        actor_user_id=world["student_id"], assignment_id=world["assignment_id"],
        reason="upload_too_large", request_bytes=11_600_000,
    )
    r = await client.get(
        "/v1/admin/blocked-submissions", params={"days": 1},
        headers=auth_headers(admin_token),
    )
    assert len(r.json()["students"]) == 1
    r = await client.get(
        "/v1/admin/blocked-submissions",
        params={"school_id": str(uuid.uuid4())},
        headers=auth_headers(admin_token),
    )
    assert r.json()["students"] == []


async def test_blocked_submissions_requires_admin(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    r = await client.get(
        "/v1/admin/blocked-submissions", headers=auth_headers(world["teacher_token"]),
    )
    assert r.status_code == 403


# ── The per-problem case ────────────────────────────────────────────

async def test_case_joins_grade_and_integrity_per_problem(
    client: AsyncClient, world: dict[str, Any], admin_token: str,
) -> None:
    set_agent_script([[make_text("Walk me through how you factored problem 1.")]])
    submission_id = await _submit_and_confirm(client, world)

    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == uuid.UUID(submission_id))
        )).scalar_one()
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        problem_id = str(problem.id)
        # The grade, written the way the grader writes it: the AI's
        # snapshot keyed by position, the live breakdown keyed by item,
        # and the teacher having bumped this one to partial credit.
        s.add(SubmissionGrade(
            submission_id=uuid.UUID(submission_id),
            ai_score=100.0, final_score=60.0,
            ai_breakdown={"grades": [{
                "problem_position": 1, "student_answer": "x = 2 or x = 3",
                "score_status": "full", "percent": 100, "confidence": 0.91,
                "reasoning": "Factored correctly and stated both roots.",
                "student_feedback": "Nice factoring.",
            }]},
            breakdown=[{
                "problem_id": str(world["primary_id"]), "score_status": "partial",
                "percent": 60.0, "feedback": "Show the check step.",
            }],
        ))
        await s.commit()

    set_agent_script([
        [
            # No question mark: the pipeline refuses finish_check while
            # a question to the student is outstanding.
            make_text("Right — that's the setup, and the numbers are 2 and 3."),
            make_tool_use("submit_problem_verdict", {
                "problem_id": problem_id,
                "rubric": {"paraphrase_originality": "low", "causal_fluency": "low",
                           "self_correction": "not_observed"},
                "reasoning": "Restated the steps but could not say why.",
            }, use_id="u1"),
        ],
        [
            make_tool_use("finish_check", {
                "disposition": "flag_for_review",
                "summary": "Correct on paper; could not explain the method.",
                "headline": "Review — correct work but couldn't explain it",
                "inline_variant_result": "not_applicable",
            }, use_id="u2"),
        ],
    ])
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn",
        headers=auth_headers(world["student_token"]),
        json={
            "message": "i just factored it",
            "seconds_on_turn": 97,
            "telemetry": {
                "focus_blur_events": [{"at": "2026-09-07T15:52:24.973Z", "duration_ms": 34059}],
                "paste_events": [],
                "typing_cadence": {"total_ms": 60000, "pauses_over_3s": 3, "edits": 50},
                "device_type": "desktop",
                "need_more_time_used": False,
            },
        },
    )
    assert r.status_code == 200, r.text

    r = await client.get(
        f"/v1/admin/submissions/{submission_id}/case", headers=auth_headers(admin_token),
    )
    assert r.status_code == 200, r.text
    case = r.json()
    assert case["student_id"] == str(world["student_id"])
    assert case["assignment_title"] == "HW 1"

    # One problem on this homework, and everything about it in one row.
    assert len(case["problems"]) == 1
    p = case["problems"][0]
    assert p["position"] == 1
    assert p["bank_item_id"] == str(world["primary_id"])
    assert p["question"] == "Solve x^2 - 5x + 6 = 0"
    assert p["answer_key"] == "x = 2 or x = 3"
    assert p["grade"]["score_status"] == "full"
    assert p["grade"]["confidence"] == 0.91
    assert p["grade"]["reasoning"].startswith("Factored correctly")
    assert p["final"] == {
        "score_status": "partial", "percent": 60.0,
        "feedback": "Show the check step.", "differs_from_ai": True,
    }
    assert p["integrity"]["kind"] == "probed"
    assert p["integrity"]["status"] == "verdict_submitted"
    assert p["integrity"]["rubric"]["paraphrase_originality"] == "low"
    assert p["integrity"]["reasoning"] == "Restated the steps but could not say why."
    # The mocked extraction carries no final answer, so the pipeline
    # files this student as struggling and picks the easiest problem.
    assert p["integrity"]["selected_reason"] == "struggling_easiest"

    assert case["grade"]["ai_score"] == 100.0
    assert case["grade"]["final_score"] == 60.0

    integ = case["integrity"]
    assert integ["status"] == "complete"
    assert integ["disposition"] == "flag_for_review"
    assert integ["headline"] == "Review — correct work but couldn't explain it"
    # One unattributed step is below the attempted-work threshold, so
    # the agent was briefed to anchor on the problem, not the attempt.
    assert integ["tier"] == "struggling"
    assert integ["posture"] == "struggling_blank"
    assert integ["probe_selection_reason"] == "struggling_easiest"
    # The telemetry rollup the teacher sees, and the turn it flagged.
    assert integ["activity_summary"]["totals"]["tab_out_count"] == 1
    assert integ["activity_summary"]["notable_turns"][0]["reasons"] == ["long_tab_out"]

    # The whole loop is in the transcript, tool calls included — with
    # their arguments parsed so the thread can render "verdict
    # recorded · P1 · paraphrase low" without re-parsing JSON.
    roles = [t["role"] for t in integ["turns"]]
    assert roles == [
        "agent", "student", "agent", "tool_call", "tool_result",
        "tool_call", "tool_result", "agent",
    ]
    student_turn = integ["turns"][1]
    assert student_turn["seconds_on_turn"] == 97
    assert student_turn["telemetry"]["focus_blur_events"][0]["duration_ms"] == 34059
    verdict = integ["turns"][3]
    assert verdict["tool_name"] == "submit_problem_verdict"
    assert verdict["tool_input"]["problem_id"] == problem_id
    assert verdict["tool_input"]["rubric"]["causal_fluency"] == "low"
    assert integ["turns"][4]["content"].startswith("accepted")
    finish = integ["turns"][5]
    assert finish["tool_name"] == "finish_check"
    assert finish["tool_input"]["disposition"] == "flag_for_review"
    assert integ["turns"][2]["tool_input"] is None

    # FERPA: the admin's read of a named student's record is logged.
    async with get_session_factory()() as s:
        access = (await s.execute(
            select(StudentRecordAccessLog).where(
                StudentRecordAccessLog.record_type == "submission_case",
                StudentRecordAccessLog.record_id == uuid.UUID(submission_id),
            )
        )).scalars().all()
    assert len(access) == 1
    assert access[0].target_student_id == world["student_id"]


async def test_case_before_any_ai_ran_is_all_nulls(
    client: AsyncClient, world: dict[str, Any], admin_token: str,
) -> None:
    """A submission with no grade and no check still answers: the
    problems are listed with nothing decided about them, and both
    summaries are null rather than fabricated."""
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=auth_headers(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    submission_id = r.json()["submission_id"]
    await drain_integrity_background_tasks()

    r = await client.get(
        f"/v1/admin/submissions/{submission_id}/case", headers=auth_headers(admin_token),
    )
    assert r.status_code == 200, r.text
    case = r.json()
    assert case["grade"] is None
    assert case["integrity"] is None
    assert [p["position"] for p in case["problems"]] == [1]
    assert case["problems"][0]["grade"] is None
    assert case["problems"][0]["final"] is None
    assert case["problems"][0]["integrity"] is None


async def test_case_404s_and_requires_admin(
    client: AsyncClient, world: dict[str, Any], admin_token: str,
) -> None:
    r = await client.get(
        f"/v1/admin/submissions/{uuid.uuid4()}/case", headers=auth_headers(admin_token),
    )
    assert r.status_code == 404
    r = await client.get(
        f"/v1/admin/submissions/{uuid.uuid4()}/case", headers=auth_headers(world["teacher_token"]),
    )
    assert r.status_code == 403
