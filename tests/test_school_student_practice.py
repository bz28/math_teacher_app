"""Integration tests for the school-student practice/learn loop endpoints.

These exercise the full validation chain on /v1/school/student/... by
seeding minimal DB state directly via the shared `world` fixture in
tests/conftest.py.

No LLM is involved — distractors and solution steps are seeded as plain
data on QuestionBankItem rows.
"""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select, text

from api.core.auth import create_access_token, hash_password
from api.core.integrity_ai import UNREADABLE_THRESHOLD
from api.database import get_session_factory
from api.models.assignment import Submission, SubmissionGrade
from api.models.user import User
from api.routes.school_student_practice import drain_integrity_background_tasks
from tests.conftest import TINY_PNG
from tests.conftest import auth_headers as _auth

# ── Tests ──

async def test_serves_oldest_unseen_sibling_first(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "served"
    # Oldest = first inserted approved sibling
    assert body["variation"]["bank_item_id"] == str(world["approved_sibling_ids"][0])
    assert body["remaining"] == 2  # 3 approved - 1 just served
    assert body["anchor_bank_item_id"] == str(world["primary_id"])
    assert len(body["variation"]["distractors"]) == 3


async def test_skips_pending_siblings(client: AsyncClient, world: dict[str, Any]) -> None:
    # Burn through all 3 approved siblings
    for _ in range(3):
        r = await client.post(
            f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
            headers=_auth(world["student_token"]),
        )
        # Mark each as completed so the next call advances
        if r.json()["status"] == "served":
            await client.post(
                f"/v1/school/student/bank-consumption/{r.json()['consumption_id']}/complete",
                headers=_auth(world["student_token"]),
            )
    # 4th call: pending sibling should NOT count, so we're exhausted
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.json()["status"] == "exhausted"
    assert r.json()["seen"] == 3


async def test_refresh_safe_re_serves_in_flight(client: AsyncClient, world: dict[str, Any]) -> None:
    r1 = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    served_id = r1.json()["variation"]["bank_item_id"]
    consumption_id = r1.json()["consumption_id"]

    # Don't complete it. Hit the endpoint again — should re-serve same.
    r2 = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r2.json()["variation"]["bank_item_id"] == served_id
    assert r2.json()["consumption_id"] == consumption_id


async def test_404_for_nonexistent_assignment(client: AsyncClient, world: dict[str, Any]) -> None:
    fake = uuid.uuid4()
    r = await client.post(
        f"/v1/school/student/homework/{fake}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404


async def test_403_for_unenrolled_student(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 403


async def test_404_when_bank_item_not_in_assignment(client: AsyncClient, world: dict[str, Any]) -> None:
    # Pass a sibling id (which is NOT a primary on the assignment)
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['approved_sibling_ids'][0]}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404


async def test_403_for_unpublished_assignment(client: AsyncClient, world: dict[str, Any]) -> None:
    async with get_session_factory()() as s:
        a = (await s.execute(
            text("UPDATE assignments SET status='draft' WHERE id=:id RETURNING id"),
            {"id": world["assignment_id"]},
        ))
        await s.commit()
        _ = a
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 403


async def test_empty_when_no_approved_siblings(client: AsyncClient, world: dict[str, Any]) -> None:
    # Reject all approved siblings
    async with get_session_factory()() as s:
        await s.execute(text(
            "UPDATE question_bank_items SET status='rejected' WHERE parent_question_id=:p"
        ), {"p": world["primary_id"]})
        await s.commit()
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.json()["status"] == "empty"


async def test_complete_consumption_idempotent(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    cid = r.json()["consumption_id"]
    for _ in range(2):
        r2 = await client.post(
            f"/v1/school/student/bank-consumption/{cid}/complete",
            headers=_auth(world["student_token"]),
        )
        assert r2.status_code == 204


async def test_complete_consumption_not_yours(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    cid = r.json()["consumption_id"]
    r2 = await client.post(
        f"/v1/school/student/bank-consumption/{cid}/complete",
        headers=_auth(world["outsider_token"]),
    )
    assert r2.status_code == 403


async def test_list_classes(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.get("/v1/school/student/classes", headers=_auth(world["student_token"]))
    assert r.status_code == 200
    out = r.json()
    assert len(out) == 1
    assert out[0]["course_name"] == "Algebra 1"
    assert out[0]["section_name"] == "Period 1"

    # Outsider sees nothing
    r = await client.get("/v1/school/student/classes", headers=_auth(world["outsider_token"]))
    assert r.json() == []


async def test_list_homework_for_course(client: AsyncClient, world: dict[str, Any]) -> None:
    # Get course id from classes
    classes = (await client.get(
        "/v1/school/student/classes", headers=_auth(world["student_token"])
    )).json()
    course_id = classes[0]["course_id"]
    r = await client.get(
        f"/v1/school/student/courses/{course_id}/homework",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    out = r.json()
    assert len(out) == 1
    assert out[0]["title"] == "HW 1"
    assert out[0]["problem_count"] == 1

    # Outsider sees nothing for this course
    r = await client.get(
        f"/v1/school/student/courses/{course_id}/homework",
        headers=_auth(world["outsider_token"]),
    )
    assert r.json() == []


async def test_homework_detail(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    out = r.json()
    assert out["title"] == "HW 1"
    assert out["course_name"] == "Algebra 1"
    assert len(out["problems"]) == 1
    assert out["problems"][0]["bank_item_id"] == str(world["primary_id"])
    # 3 approved siblings (pending one excluded)
    assert out["problems"][0]["approved_variation_count"] == 3
    # SECURITY: the locked HW primary's final_answer must NOT be sent
    # to the student. Otherwise opening DevTools reveals the answer.
    assert "final_answer" not in out["problems"][0]
    assert "solution_steps" not in out["problems"][0]


async def test_homework_detail_403_for_outsider(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 403


async def test_submit_homework_happy_path(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "submission_id" in body
    assert body["is_late"] is False

    # Detail endpoint reflects submitted state
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}",
        headers=_auth(world["student_token"]),
    )
    assert r.json()["submitted"] is True
    assert r.json()["submission_id"] == body["submission_id"]

    # Get-my-submission returns the data — final_answers is null on
    # new submissions (will be populated by the integrity-checker PR
    # from a Vision-extracted confirm step).
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/submission",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    out = r.json()
    assert out["final_answers"] == {}
    assert out["files"] and len(out["files"]) == 1
    assert out["files"][0]["media_type"] == "image/png"
    assert out["is_late"] is False


async def test_submit_homework_409_on_resubmit(client: AsyncClient, world: dict[str, Any]) -> None:
    body = {"files": [TINY_PNG]}
    r1 = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json=body,
    )
    assert r1.status_code == 200
    r2 = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json=body,
    )
    assert r2.status_code == 409


async def test_submit_homework_400_missing_files(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # No body field at all → 422 from pydantic (files is required).
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={},
    )
    assert r.status_code == 422

    # Empty list → 422 from the field validator on SubmitHomeworkRequest.
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": []},
    )
    assert r.status_code == 422


async def test_submit_homework_400_bad_image_format(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Magic-byte check rejects payloads that aren't JPEG, PNG, or PDF.
    # The error names which file failed so the frontend can highlight
    # the offending row instead of "your upload failed".
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": ["ZmFrZWltYWdl"]},
    )
    assert r.status_code == 400
    assert "File 1" in r.json()["detail"]


async def test_submit_homework_400_rejects_svg(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Even though browsers don't execute scripts in SVGs loaded via
    # <img src=...>, the upload validator keeps the storage path tight
    # — only JPEG/PNG/PDF magic bytes pass.
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="]},
    )
    assert r.status_code == 400


async def test_submit_homework_accepts_data_url_png(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Data-URL prefix is optional — the route strips it and validates
    # the underlying base64 by magic bytes. Belt-and-suspenders for
    # clients that prefer to send the canonical data URL form.
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [f"data:image/png;base64,{TINY_PNG}"]},
    )
    assert r.status_code == 200


async def test_submit_homework_403_for_outsider(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["outsider_token"]),
        json={"files": [TINY_PNG]},
    )
    assert r.status_code == 403


async def test_get_my_submission_404_when_not_submitted(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/submission",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404


async def test_homework_list_status_reflects_submission(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    classes = (await client.get(
        "/v1/school/student/classes", headers=_auth(world["student_token"])
    )).json()
    course_id = classes[0]["course_id"]

    r = await client.get(
        f"/v1/school/student/courses/{course_id}/homework",
        headers=_auth(world["student_token"]),
    )
    assert r.json()[0]["status"] == "not_started"

    await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG]},
    )

    r = await client.get(
        f"/v1/school/student/courses/{course_id}/homework",
        headers=_auth(world["student_token"]),
    )
    assert r.json()[0]["status"] == "submitted"


async def test_submit_homework_late_marks_is_late(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Set due_at to yesterday
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET due_at = now() - interval '1 day' WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    assert r.status_code == 200
    assert r.json()["is_late"] is True


async def test_quizzes_excluded_from_homework_list(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Convert the seeded HW into a quiz and verify it disappears
    # from the student's homework tab and the loop endpoint refuses it.
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET type='quiz' WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()
    classes = (await client.get(
        "/v1/school/student/classes", headers=_auth(world["student_token"])
    )).json()
    course_id = classes[0]["course_id"]
    r = await client.get(
        f"/v1/school/student/courses/{course_id}/homework",
        headers=_auth(world["student_token"]),
    )
    # Quiz must NOT appear in the homework list
    assert r.json() == []
    # And the loop endpoint must reject it directly
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404


async def test_flag_and_list_flagged(client: AsyncClient, world: dict[str, Any]) -> None:
    # Serve + flag two siblings, complete one without flag
    served_ids = []
    for _ in range(3):
        r = await client.post(
            f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
            headers=_auth(world["student_token"]),
        )
        cid = r.json()["consumption_id"]
        served_ids.append((cid, r.json()["variation"]["bank_item_id"]))
        await client.post(
            f"/v1/school/student/bank-consumption/{cid}/complete",
            headers=_auth(world["student_token"]),
        )
    # Flag the first two
    for cid, _ in served_ids[:2]:
        r = await client.post(
            f"/v1/school/student/bank-consumption/{cid}/flag",
            headers=_auth(world["student_token"]),
            json={"flagged": True},
        )
        assert r.status_code == 204

    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/flagged",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    out = r.json()
    assert len(out) == 2
    assert {x["consumption_id"] for x in out} == {served_ids[0][0], served_ids[1][0]}

    # Unflag one and re-list
    r = await client.post(
        f"/v1/school/student/bank-consumption/{served_ids[0][0]}/flag",
        headers=_auth(world["student_token"]),
        json={"flagged": False},
    )
    assert r.status_code == 204
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/flagged",
        headers=_auth(world["student_token"]),
    )
    assert len(r.json()) == 1


# ── Teacher submission viewing ──

async def test_teacher_list_submissions_uses_existing_endpoint(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # The existing /v1/teacher/assignments/{id}/submissions endpoint
    # was built for the old grading flow but already returns the
    # fields the new submission UI needs (id, student_name, is_late,
    # submitted_at). We don't add a duplicate — just confirm it works
    # against rows our new submit endpoint creates.
    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/submissions",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200
    assert r.json()["submissions"] == []

    await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/submissions",
        headers=_auth(world["teacher_token"]),
    )
    rows = r.json()["submissions"]
    assert len(rows) == 1
    assert rows[0]["is_late"] is False
    assert rows[0]["student_email"]


async def test_teacher_submission_detail(client: AsyncClient, world: dict[str, Any]) -> None:
    submit_resp = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    submission_id = submit_resp.json()["submission_id"]

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200
    out = r.json()
    assert out["submission_id"] == submission_id
    assert out["student_id"] == str(world["student_id"])
    assert len(out["problems"]) == 1
    p = out["problems"][0]
    assert p["bank_item_id"] == str(world["primary_id"])
    # New submissions have null student_answer (the integrity-checker
    # PR will populate it from a Vision-extracted confirm step).
    assert p["student_answer"] is None
    # Teacher view DOES include the answer key (the teacher needs it)
    assert p["final_answer"] == "x = 2 or x = 3"
    assert out["files"] and len(out["files"]) == 1


async def test_teacher_submission_detail_surfaces_student_edits(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """When the student corrected a Vision misread on the confirm
    screen, the teacher review payload renders the edited text as the
    canonical step and ferries the original Vision read in
    `original_*` so the UI can offer a "view original" disclosure.
    Unedited steps render unchanged with edited=False."""
    submit_resp = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    submission_id = submit_resp.json()["submission_id"]
    await drain_integrity_background_tasks()

    # Stage a richer extraction (real problem_position / step_num) and
    # a sparse edit overlay matching the position the test world's
    # primary problem occupies (1).
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE submissions SET extraction = :ext, "
                "extraction_edits = :ed WHERE id = :id"
            ),
            {
                "id": submission_id,
                "ext": (
                    '{"steps": ['
                    '{"step_num": 1, "problem_position": 1, '
                    '"latex": "x=5", "plain_english": "x equals five"},'
                    '{"step_num": 2, "problem_position": 1, '
                    '"latex": "y=10", "plain_english": "y equals ten"}'
                    '], "final_answers": [], "confidence": 0.9}'
                ),
                "ed": '{"1:1": "x = 5/2"}',
            },
        )
        await s.commit()

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200
    steps = r.json()["problems"][0]["student_steps"]
    assert len(steps) == 2
    edited, unedited = steps[0], steps[1]
    assert edited["edited"] is True
    # Original step 1:1 had populated `latex` ("x=5"), so the edit
    # routes back into latex — not plain_english — so the teacher's
    # rendering stays in math mode and reflects the source field.
    assert edited["latex"] == "x = 5/2"
    assert edited["plain_english"] == ""
    assert edited["original_latex"] == "x=5"
    assert edited["original_plain_english"] == "x equals five"
    assert unedited["edited"] is False
    assert unedited["original_latex"] is None
    assert unedited["plain_english"] == "y equals ten"


async def _submit_and_stage_extraction(
    client: AsyncClient,
    world: dict[str, Any],
    extraction: str,
    edits: str | None = None,
) -> str:
    """Submit as the student, then overwrite the persisted extraction.

    Every teacher-view answer-precedence test needs the same setup: a
    real submission (so ownership and problem hydration are exercised)
    carrying a hand-authored extraction. Returns the submission id.
    Leaves no SubmissionGrade row, which is the pre-grading window the
    answer chain is most load-bearing in.
    """
    submit_resp = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    submission_id = submit_resp.json()["submission_id"]
    await drain_integrity_background_tasks()
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE submissions SET extraction = :ext, "
                "extraction_edits = :ed WHERE id = :id"
            ),
            {"id": submission_id, "ext": extraction, "ed": edits},
        )
        await s.commit()
    return submission_id


# A readable extraction carrying one final answer for problem 1.
_READABLE_EXTRACTION = (
    '{"steps": [], "final_answers": ['
    '{"problem_position": 1, "answer_latex": "5", '
    '"answer_plain": "five"}], "confidence": 0.9}'
)


async def test_teacher_submission_detail_surfaces_edited_final_pre_grading(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """An edited `:final` answer must be visible to the teacher view
    even before AI grading completes (or with ai_grading_enabled=false).
    Without this, the edit only surfaces once the AI grader writes its
    breakdown, which leaves a confusing UI window where the student's
    correction looks lost. Mirrors the priority order documented at
    teacher_assignments.py: edited > extracted > AI echo > None."""
    submission_id = await _submit_and_stage_extraction(
        client, world, _READABLE_EXTRACTION, '{"1:final": "16 apples"}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200
    p = r.json()["problems"][0]
    assert p["student_answer"] == "16 apples"


async def test_teacher_submission_detail_surfaces_unedited_extracted_final(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The common case: the student accepted Vision's read without
    editing it, and AI grading hasn't run yet (it's deferred to the due
    date). The extracted final answer must still reach the teacher —
    before this, the review page showed "No answer extracted" while the
    answer sat in `Submission.extraction` and the student had already
    been shown it on their own confirm screen."""
    submission_id = await _submit_and_stage_extraction(
        client, world, _READABLE_EXTRACTION,
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200
    p = r.json()["problems"][0]
    # `answer_latex` wins over `answer_plain` and arrives `$`-delimited:
    # the field is raw LaTeX by contract, and the teacher view renders
    # this string through MathText, which prints undelimited input as
    # source. Same wrapping the canonical renderer applies
    # (extraction-view.tsx).
    assert p["student_answer"] == "$5$"


async def test_teacher_submission_detail_falls_back_to_answer_plain(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Vision emits an empty `answer_latex` when the student wrote prose;
    the plain-language reading is then the only answer there is."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [], "final_answers": ['
        '{"problem_position": 1, "answer_latex": "", '
        '"answer_plain": "sixteen apples"}], "confidence": 0.9}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.json()["problems"][0]["student_answer"] == "sixteen apples"


async def test_teacher_submission_detail_hides_unreadable_extraction(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Below the unreadable threshold the read is untrustworthy by
    definition — it is what makes the pipeline skip auto-grading and
    stamp `skipped_unreadable`. The teacher must keep seeing the honest
    "no answer extracted" warning rather than confident nonsense, on
    exactly the submission where they most depend on the photo."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [], "final_answers": ['
        '{"problem_position": 1, "answer_latex": "5", '
        '"answer_plain": "five"}], "confidence": 0.1}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.json()["problems"][0]["student_answer"] is None


async def test_teacher_submission_detail_unreadable_still_honors_edit(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The confidence gate applies to the machine read, not to the
    student. A confirm-screen edit is a human claim about what they
    wrote, so it outranks the gate and surfaces even when Vision rated
    its own read unreadable."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [], "final_answers": ['
        '{"problem_position": 1, "answer_latex": "5", '
        '"answer_plain": "five"}], "confidence": 0.1}',
        '{"1:final": "16 apples"}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.json()["problems"][0]["student_answer"] == "16 apples"


async def test_teacher_submission_detail_ai_echo_outranks_extraction(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Once grading has run, the teacher sees the answer the grade was
    actually computed against, not the raw read. The echo reflects how
    the model resolved the extraction (duplicate candidates, blanks) and
    is delimited for display, so promoting the raw read above it would
    let the cell disagree with the verdict printed beside it. The
    extraction fills the cell only when the echo has nothing."""
    submission_id = await _submit_and_stage_extraction(
        client, world, _READABLE_EXTRACTION,
    )
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(
            submission_id=uuid.UUID(submission_id),
            breakdown=[{
                "problem_id": str(world["primary_id"]),
                "score_status": "full",
                "percent": 100.0,
                "student_answer": "$x = 5$",
            }],
        ))
        await s.commit()

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.json()["problems"][0]["student_answer"] == "$x = 5$"


async def test_teacher_submission_detail_extraction_fills_null_ai_echo(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A graded submission whose breakdown carries no `student_answer` —
    the model declined to restate it, or the row is one of the
    synthesized "no gradeable work" zeros. The extraction is then the
    only reading of the page there is, and it must still reach the
    teacher rather than falling to the warning."""
    submission_id = await _submit_and_stage_extraction(
        client, world, _READABLE_EXTRACTION,
    )
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(
            submission_id=uuid.UUID(submission_id),
            breakdown=[{
                "problem_id": str(world["primary_id"]),
                "score_status": "full",
                "percent": 100.0,
                "student_answer": None,
            }],
        ))
        await s.commit()

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.json()["problems"][0]["student_answer"] == "$5$"


async def test_teacher_submission_detail_first_non_empty_final_wins(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The extraction schema doesn't enforce one final answer per
    position. An empty leading entry must not claim the slot and block a
    later real one, and a non-int position must not be attributed to any
    problem."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [], "final_answers": ['
        '{"problem_position": "1", "answer_latex": "bogus", "answer_plain": ""},'
        '{"problem_position": 1, "answer_latex": "", "answer_plain": ""},'
        '{"problem_position": 1, "answer_latex": "7", "answer_plain": "seven"},'
        '{"problem_position": 1, "answer_latex": "9", "answer_plain": "nine"}'
        '], "confidence": 0.9}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.json()["problems"][0]["student_answer"] == "$7$"


async def test_teacher_submission_detail_survives_odd_extraction_shapes(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The extraction blob is model output persisted verbatim, so the
    endpoint must not 500 on a shape it didn't expect. Each of these
    degrades to the "no answer extracted" warning rather than an error
    the teacher can't get past."""
    for extraction in (
        # No final_answers key at all.
        '{"steps": [], "confidence": 0.9}',
        # Confidence missing entirely.
        '{"steps": [], "final_answers": [{"problem_position": 1, '
        '"answer_latex": "5", "answer_plain": "five"}]}',
        # Confidence explicitly null.
        '{"steps": [], "final_answers": [{"problem_position": 1, '
        '"answer_latex": "5", "answer_plain": "five"}], "confidence": null}',
        # Position points at a problem that isn't on this assignment.
        '{"steps": [], "final_answers": [{"problem_position": 99, '
        '"answer_latex": "5", "answer_plain": "five"}], "confidence": 0.9}',
    ):
        submission_id = await _submit_and_stage_extraction(
            client, world, extraction,
        )
        r = await client.get(
            f"/v1/teacher/submissions/{submission_id}",
            headers=_auth(world["teacher_token"]),
        )
        assert r.status_code == 200, extraction
        assert r.json()["problems"][0]["student_answer"] is None, extraction
        async with get_session_factory()() as s:
            await s.execute(
                text("DELETE FROM submissions WHERE id = :id"),
                {"id": submission_id},
            )
            await s.commit()


async def test_teacher_submission_detail_confidence_at_threshold(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The gate is `>= UNREADABLE_THRESHOLD`, the exact complement of the
    `< UNREADABLE_THRESHOLD` checks the pipeline skips grading on. A
    submission sitting exactly on the boundary is readable to both."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [], "final_answers": ['
        '{"problem_position": 1, "answer_latex": "5", '
        f'"answer_plain": "five"}}], "confidence": {UNREADABLE_THRESHOLD}}}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.json()["problems"][0]["student_answer"] == "$5$"


async def test_teacher_submission_detail_surfaces_unattributed_work(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Steps the extractor couldn't tie to a problem must reach the
    teacher. `grading_ai._build_user_message` hands the grader these same
    lines under "Other work" and tells it to use them as context, so
    dropping them left a grade resting on evidence invisible on the page
    where it is reviewed.

    Two ways in, and the grader buckets both the same way: a null
    `problem_position`, and a position that isn't on this assignment —
    which is how a stale tag reads after problems have been reordered.
    """
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": ['
        '{"step_num": 1, "problem_position": 1, "latex": "x = 5", '
        '"plain_english": "solve"},'
        '{"step_num": 2, "problem_position": null, "latex": "", '
        '"plain_english": "check: 5 times 3 is 15"},'
        '{"step_num": 3, "problem_position": 99, "latex": "d = b^2 - 4ac", '
        '"plain_english": ""},'
        '{"step_num": 4, "problem_position": null, "latex": "", '
        '"plain_english": ""}'
        '], "final_answers": [], "confidence": 0.9}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200
    body = r.json()

    # The attributed step still lands on its problem, not in the bucket.
    assert [st["plain_english"] for st in body["problems"][0]["student_steps"]] == [
        "solve"
    ]
    # Null position and off-assignment position both surface; the wholly
    # empty step is dropped rather than rendering a blank row.
    other = body["other_work"]
    assert len(other) == 2
    assert other[0]["plain_english"] == "check: 5 times 3 is 15"
    assert other[1]["latex"] == "d = b^2 - 4ac"


async def test_teacher_submission_detail_other_work_empty_by_default(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A clean submission carries an empty bucket, so the UI can hide the
    disclosure entirely rather than showing an empty one."""
    submission_id = await _submit_and_stage_extraction(
        client, world, _READABLE_EXTRACTION,
    )
    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.json()["other_work"] == []


async def test_other_work_honors_a_student_edit(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A step whose position isn't on this assignment still went through
    the confirm screen as an editable row — that screen only locks a
    group when the position is NULL, so a stale tag stays editable. The
    grader consumes the overlaid view, so the teacher must see the
    corrected text too; showing the pre-correction read under copy that
    says "the AI saw these" would be a lie."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [{"step_num": 2, "problem_position": 99, '
        '"latex": "x = 5", "plain_english": ""}], '
        '"final_answers": [], "confidence": 0.9}',
        '{"99:2": "x = 6"}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    other = r.json()["other_work"]
    assert len(other) == 1
    assert other[0]["latex"] == "x = 6"
    assert other[0]["edited"] is True
    assert other[0]["original_latex"] == "x = 5"


async def test_other_work_drops_a_step_the_student_cleared(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Clearing a row removes it from the grader's prompt, so it must not
    linger on the review page as a phantom line the AI never saw."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [{"step_num": 2, "problem_position": 99, '
        '"latex": "x = 5", "plain_english": ""}], '
        '"final_answers": [], "confidence": 0.9}',
        '{"99:2": ""}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.json()["other_work"] == []


async def test_other_work_includes_unplaced_final_answers(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The grader buckets unattributed final answers into the same "Other
    work" block as unattributed steps, so surfacing only the steps would
    leave an answer the model received still invisible here."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [], "final_answers": ['
        '{"problem_position": 99, "answer_latex": "42", "answer_plain": ""},'
        '{"problem_position": 1, "answer_latex": "5", "answer_plain": ""}'
        '], "confidence": 0.9}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    body = r.json()
    # Raw and UNDELIMITED: `StudentStepRow` renders a step's latex as
    # `$${latex}$$`, so a pre-wrapped value would reach KaTeX as
    # `$$$42$$$` and render an error glyph. The `$…$` convention belongs
    # to `student_answer`, which the review page passes through raw.
    assert [st["latex"] for st in body["other_work"]] == ["42"]
    # The one that DOES place still goes to its problem, not the bucket,
    # and IS delimited, because that field is rendered unwrapped.
    assert body["problems"][0]["student_answer"] == "$5$"


async def test_other_work_keeps_distinct_answers_sharing_a_position(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Two different reads tagged with the same unplaced position are two
    things the model was actually given. `grading_ai._build_user_message`
    renders every candidate rather than losing all but one, and this
    bucket exists to show the teacher what the grader saw, so it must not
    collapse them either. Only a literal repeat is noise."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [], "final_answers": ['
        '{"problem_position": 99, "answer_latex": "42", "answer_plain": ""},'
        '{"problem_position": 99, "answer_latex": "7", "answer_plain": ""},'
        '{"problem_position": 99, "answer_latex": "42", "answer_plain": ""}'
        '], "confidence": 0.9}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert [st["latex"] for st in r.json()["other_work"]] == ["42", "7"]


async def test_other_work_dedupes_on_what_it_actually_renders(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """`answer_plain` is dropped whenever `answer_latex` is set, so two
    reads that differ ONLY in their plain text render as the same line.
    Keying the dedupe on the raw pair let both through and the teacher saw
    "42" twice, which is exactly the literal repeat the bucket drops."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [], "final_answers": ['
        '{"problem_position": 99, "answer_latex": "42", '
        '"answer_plain": "forty-two"},'
        '{"problem_position": 99, "answer_latex": "42", '
        '"answer_plain": "42 units"},'
        '{"problem_position": 99, "answer_latex": "7", "answer_plain": ""}'
        '], "confidence": 0.9}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    # One "42" — the two entries render identically — and the genuinely
    # different answer still survives.
    assert [st["latex"] for st in r.json()["other_work"]] == ["42", "7"]


async def test_other_work_empty_duplicate_does_not_hide_a_real_answer(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """An empty entry must not consume the slot for a later real one at
    the same position. The grader still receives the real answer, so
    dropping it here would reopen the exact asymmetry this bucket was
    added to close."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [], "final_answers": ['
        '{"problem_position": 99, "answer_latex": "", "answer_plain": ""},'
        '{"problem_position": 99, "answer_latex": "42", "answer_plain": ""}'
        '], "confidence": 0.9}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert [st["latex"] for st in r.json()["other_work"]] == ["42"]


async def test_other_work_final_answer_honors_a_student_edit(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Final answers are editable for the same reason steps are: the
    confirm screen keys `{position}:final` off any integer position and
    only locks a group when the position is NULL. The grader consumes the
    edit, so the teacher must see it too."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [], "final_answers": ['
        '{"problem_position": 99, "answer_latex": "42", "answer_plain": ""}'
        '], "confidence": 0.9}',
        '{"99:final": "43"}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    other = r.json()["other_work"]
    assert len(other) == 1
    assert other[0]["latex"] == "43"
    assert other[0]["edited"] is True
    assert other[0]["original_latex"] == "42"


async def test_other_work_drops_a_final_answer_the_student_cleared(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """`apply_extraction_edits` drops a cleared final answer from the
    grader's prompt, so leaving it here would list a phantom line under
    copy saying the AI saw it."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [], "final_answers": ['
        '{"problem_position": 99, "answer_latex": "42", "answer_plain": ""}'
        '], "confidence": 0.9}',
        '{"99:final": ""}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.json()["other_work"] == []


async def test_bool_problem_position_is_not_problem_one(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """`True` is an `int` in Python and `True in {1, ...}` is True, so a
    bare isinstance check would file a step tagged `true` under problem 1.
    `grading_ai` excludes bools explicitly; this must agree, or the two
    views of the same submission diverge."""
    submission_id = await _submit_and_stage_extraction(
        client,
        world,
        '{"steps": [{"step_num": 1, "problem_position": true, '
        '"latex": "bogus", "plain_english": ""}], '
        '"final_answers": [], "confidence": 0.9}',
    )

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    body = r.json()
    assert body["problems"][0]["student_steps"] == []
    assert [st["latex"] for st in body["other_work"]] == ["bogus"]


async def test_teacher_submission_detail_403_for_other_teacher(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # First, the real teacher submits something
    submit_resp = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    submission_id = submit_resp.json()["submission_id"]

    async with get_session_factory()() as s:
        other = User(
            email=f"other2_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12,
            role="teacher",
            name="OT2",
        )
        s.add(other)
        await s.commit()
        other_token = create_access_token(str(other.id), "teacher")

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(other_token),
    )
    assert r.status_code == 403


async def test_teacher_submission_detail_404_for_missing(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await client.get(
        f"/v1/teacher/submissions/{uuid.uuid4()}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 404


# ── Extraction confirm / flag ──────────────────────────────────────
#
# Both endpoints stamp mutually-exclusive timestamps on the Submission
# row. A DB CHECK constraint plus a conditional UPDATE enforce that
# only one can win, even under concurrent requests. These tests cover
# the happy paths + the idempotency / exclusion guards from those two
# layers.


async def _submit_and_extract(
    client: AsyncClient, world: dict[str, Any]
) -> str:
    """Submit + drain so `sub.extraction` is populated and the confirm
    endpoint can run. Returns the submission_id."""
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    assert r.status_code == 200, r.text
    await drain_integrity_background_tasks()
    return r.json()["submission_id"]


async def test_confirm_extraction_happy_path(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    submission_id = await _submit_and_extract(client, world)
    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
    )
    # Drain so the spawned integrity + grading pipeline doesn't leak
    # into the next test's session — matches the pattern in
    # tests/test_integrity_check.py::_submit.
    await drain_integrity_background_tasks()
    assert r.status_code == 200
    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == uuid.UUID(submission_id))
        )).scalar_one()
        assert sub.extraction_confirmed_at is not None
        assert sub.extraction_flagged_at is None


async def test_confirm_extraction_idempotent(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    submission_id = await _submit_and_extract(client, world)
    r1 = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
    )
    await drain_integrity_background_tasks()
    r2 = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    # Second call is a no-op but still succeeds (doesn't 500 or 409
    # since the student just refreshed / double-tapped). No drain
    # needed after — the second call bails before spawning.
    assert r2.json().get("already_confirmed") is True


async def test_flag_extraction_happy_path(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    submission_id = await _submit_and_extract(client, world)
    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/flag-extraction",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == uuid.UUID(submission_id))
        )).scalar_one()
        assert sub.extraction_flagged_at is not None
        assert sub.extraction_confirmed_at is None


async def test_flag_after_confirm_409(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    submission_id = await _submit_and_extract(client, world)
    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
    )
    # Drain the pipeline spawned by confirm before the follow-up flag
    # attempt, so the background task doesn't leak into the next test.
    await drain_integrity_background_tasks()
    assert r.status_code == 200
    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/flag-extraction",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 409


async def test_confirm_after_flag_409(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    submission_id = await _submit_and_extract(client, world)
    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/flag-extraction",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 409


async def test_confirm_before_extraction_409(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Calling confirm before the background Vision call has populated
    `sub.extraction` returns 409 — there's nothing to confirm yet."""
    submission_id = await _submit_and_extract(client, world)
    # Null out extraction AFTER the drain so we're not racing the
    # background task. Simulates the state the student sees if they
    # click confirm before extraction finishes.
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE submissions SET extraction = NULL WHERE id = :id"),
            {"id": submission_id},
        )
        await s.commit()

    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 409


async def test_confirm_403_for_other_student(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    submission_id = await _submit_and_extract(client, world)
    # The shared `outsider` fixture is a student not owning this
    # submission — confirming on it should 403 before any pipeline
    # spawn, so no drain needed.
    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 403


async def test_confirm_with_edits_persists_overlay(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Edits posted with confirm land on extraction_edits + stamp
    extraction_edited_at. Original extraction stays untouched. Stale
    keys are silently dropped (the helper validates server-side)."""
    submission_id = await _submit_and_extract(client, world)
    # Replace the mock extraction with one that has real
    # problem_position / step_num so edit keys can target a row.
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE submissions SET extraction = :ext WHERE id = :id"
            ),
            {
                "id": submission_id,
                "ext": (
                    '{"steps": [{"step_num": 1, "problem_position": 1, '
                    '"latex": "x=5", "plain_english": "x equals five"}], '
                    '"final_answers": [{"problem_position": 1, '
                    '"answer_latex": "5", "answer_plain": "five"}], '
                    '"confidence": 0.9}'
                ),
            },
        )
        await s.commit()

    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
        json={"edits": {"1:1": "x = 5/2", "99:99": "stale key"}},
    )
    await drain_integrity_background_tasks()
    assert r.status_code == 200, r.text
    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == uuid.UUID(submission_id))
        )).scalar_one()
        # Stale key dropped, only the real edit persisted
        assert sub.extraction_edits == {"1:1": "x = 5/2"}
        assert sub.extraction_edited_at is not None
        # Original extraction preserved
        assert sub.extraction is not None
        assert sub.extraction["steps"][0]["plain_english"] == "x equals five"


async def test_confirm_without_edits_leaves_overlay_null(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """When the student confirms with no body (or empty edits map),
    extraction_edits + extraction_edited_at stay null. Confirms the
    overlay is opt-in, not always populated."""
    submission_id = await _submit_and_extract(client, world)
    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
        json={"edits": {}},
    )
    await drain_integrity_background_tasks()
    assert r.status_code == 200
    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == uuid.UUID(submission_id))
        )).scalar_one()
        assert sub.extraction_edits is None
        assert sub.extraction_edited_at is None


async def test_confirm_rejects_oversized_edit_value(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """An edit value above the 2,000-char cap is a 400. Guards against
    a malicious / runaway client stuffing the column with a novel."""
    submission_id = await _submit_and_extract(client, world)
    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
        json={"edits": {"1:1": "x" * 2_001}},
    )
    assert r.status_code == 400


async def test_confirm_persists_final_answer_edit(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A `:final` edit (most-likely OCR-fix case — single-token answer)
    flows through the validate + persist path the same way step edits
    do. Previously only step edits had a regression test."""
    submission_id = await _submit_and_extract(client, world)
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE submissions SET extraction = :ext WHERE id = :id"
            ),
            {
                "id": submission_id,
                "ext": (
                    '{"steps": [], "final_answers": ['
                    '{"problem_position": 1, "answer_latex": "5", '
                    '"answer_plain": "five"}], "confidence": 0.9}'
                ),
            },
        )
        await s.commit()

    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
        json={"edits": {"1:final": "5/2"}},
    )
    await drain_integrity_background_tasks()
    assert r.status_code == 200, r.text
    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == uuid.UUID(submission_id))
        )).scalar_one()
        assert sub.extraction_edits == {"1:final": "5/2"}


async def test_confirm_persists_empty_string_edit_as_deletion(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """An empty-string edit is the deletion semantic: it lands in the
    column as `""` and `apply_extraction_edits` drops the corresponding
    row at overlay time. The integration test pins the persistence
    half; the helper unit tests cover the apply half."""
    from api.core.extraction_edits import apply_extraction_edits

    submission_id = await _submit_and_extract(client, world)
    extraction_json = (
        '{"steps": [{"step_num": 1, "problem_position": 1, '
        '"latex": "x=5", "plain_english": "x equals five"}], '
        '"final_answers": [], "confidence": 0.9}'
    )
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE submissions SET extraction = :ext WHERE id = :id"
            ),
            {"id": submission_id, "ext": extraction_json},
        )
        await s.commit()

    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
        json={"edits": {"1:1": ""}},
    )
    await drain_integrity_background_tasks()
    assert r.status_code == 200
    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == uuid.UUID(submission_id))
        )).scalar_one()
        assert sub.extraction_edits == {"1:1": ""}
        # Overlay applied: the cleared step is dropped from the view
        # the grader and teacher see.
        overlaid = apply_extraction_edits(sub.extraction, sub.extraction_edits)
        assert overlaid is not None
        assert overlaid["steps"] == []


async def test_grading_pipeline_consumes_overlaid_extraction(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Pin the contract that `_run_integrity_and_grading_background`
    applies `extraction_edits` over `extraction` BEFORE handing off
    to integrity + grading. Without this, B1 (integrity sampling
    silently ignored edited final answers) could re-regress as a
    one-line removal of `apply_extraction_edits`. The unit test in
    test_integrity_pipeline.py covers the consumer; this pins the
    seam."""
    from unittest.mock import AsyncMock, patch

    from api.routes.school_student_practice import (
        _run_integrity_and_grading_background,
    )

    submission_id = await _submit_and_extract(client, world)
    # Stage a submission ready for the background task: extraction +
    # an edit on a final answer + confirmed_at stamp (so the runner
    # treats it as past-confirm rather than bailing).
    extraction_json = (
        '{"steps": [], "final_answers": ['
        '{"problem_position": 1, "answer_latex": "5", '
        '"answer_plain": "five"}], "confidence": 0.9}'
    )
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE submissions SET extraction = :ext, "
                "extraction_edits = :ed, "
                "extraction_confirmed_at = NOW() WHERE id = :id"
            ),
            {
                "id": submission_id,
                "ext": extraction_json,
                "ed": '{"1:final": "5/2"}',
            },
        )
        await s.commit()

    captured: dict[str, Any] = {}

    async def fake_start(submission_id: Any, db: Any, *, extraction: Any) -> None:
        _ = submission_id, db
        captured["extraction"] = extraction

    with (
        patch(
            "api.routes.school_student_practice.start_integrity_check",
            side_effect=fake_start,
        ),
        patch(
            "api.core.grading_ai.run_ai_grading_for_submission",
            new=AsyncMock(),
        ),
    ):
        await _run_integrity_and_grading_background(uuid.UUID(submission_id))

    assert "extraction" in captured, (
        "start_integrity_check was never called — the runner short-circuited"
    )
    finals = captured["extraction"]["final_answers"]
    assert len(finals) == 1
    # Original final answer had populated answer_latex ("5"), so the
    # edit overlays back into answer_latex — keeping the math source
    # field as the canonical content.
    assert finals[0]["answer_latex"] == "5/2"
    assert finals[0]["answer_plain"] == ""


async def test_unreadable_extraction_skips_auto_grade(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A garbage read (confidence below UNREADABLE_THRESHOLD) must NOT be
    auto-graded. The background runner records `ai_grading_status =
    skipped_unreadable` and leaves final_score/breakdown null so the
    teacher can still grade by hand — never fabricating a score from
    junk. Pins the gate added alongside the integrity skipped_unreadable
    concept."""
    from unittest.mock import AsyncMock, patch

    from api.core.grading_ai import GRADING_STATUS_SKIPPED_UNREADABLE
    from api.models.assignment import SubmissionGrade
    from api.routes.school_student_practice import (
        _run_integrity_and_grading_background,
    )

    submission_id = await _submit_and_extract(client, world)
    # Stage a low-confidence extraction + confirmed_at; disable integrity
    # so only the grading arm runs (keeps the assertion focused on the
    # grading gate).
    extraction_json = (
        '{"steps": [], "final_answers": [], "confidence": 0.05}'
    )
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE submissions SET extraction = :ext, "
                "extraction_confirmed_at = NOW() WHERE id = :id"
            ),
            {"id": submission_id, "ext": extraction_json},
        )
        await s.execute(
            text(
                "UPDATE assignments SET integrity_check_enabled = false, "
                "ai_grading_enabled = true WHERE id = :id"
            ),
            {"id": world["assignment_id"]},
        )
        await s.commit()

    with patch(
        "api.core.grading_ai.run_ai_grading_for_submission",
        new=AsyncMock(),
    ) as mock_grade:
        await _run_integrity_and_grading_background(uuid.UUID(submission_id))

    # No auto-grade was produced.
    mock_grade.assert_not_called()

    # The needs-manual-grading state is recorded, with no fabricated score.
    async with get_session_factory()() as s:
        grade = (await s.execute(
            select(SubmissionGrade).where(
                SubmissionGrade.submission_id == uuid.UUID(submission_id)
            )
        )).scalar_one()
        assert grade.ai_grading_status == GRADING_STATUS_SKIPPED_UNREADABLE
        assert grade.final_score is None
        assert grade.breakdown is None


async def test_flag_does_not_disturb_extraction_edits(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The flag-extraction endpoint accepts no body and shouldn't touch
    extraction_edits in any direction. A submission flagged before
    confirm should keep extraction_edits null. Pins the contract so a
    future flag-with-edits feature doesn't accidentally land via this
    path (which would skip grading and silently lose edits)."""
    submission_id = await _submit_and_extract(client, world)
    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/flag-extraction",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == uuid.UUID(submission_id))
        )).scalar_one()
        assert sub.extraction_flagged_at is not None
        assert sub.extraction_edits is None
        assert sub.extraction_edited_at is None
