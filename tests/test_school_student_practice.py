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
from api.database import get_session_factory
from api.models.assignment import Submission
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
        json={"image_base64": TINY_PNG},
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
    assert out["image_data"]
    assert out["is_late"] is False


async def test_submit_homework_409_on_resubmit(client: AsyncClient, world: dict[str, Any]) -> None:
    body = {"image_base64": TINY_PNG}
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


async def test_submit_homework_400_missing_image(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # No image at all → 422 from pydantic (image_base64 is required)
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={},
    )
    assert r.status_code == 422

    # Empty string → 400 from our explicit check
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": ""},
    )
    assert r.status_code == 400


async def test_submit_homework_413_oversized_image(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    huge = "iVBOR" + ("A" * 8_000_000)
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": huge},
    )
    assert r.status_code == 413


async def test_submit_homework_400_bad_image_format(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": "ZmFrZWltYWdl"},
    )
    assert r.status_code == 400


async def test_submit_homework_400_rejects_svg(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Even though browsers don't execute scripts in SVGs loaded via
    # <img src=...>, we tighten the magic check to PNG/JPEG only so
    # nothing exotic ends up in the storage path.
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="},
    )
    assert r.status_code == 400


async def test_submit_homework_accepts_data_url_png(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Confirm the data URL form (what the frontend now sends after the
    # MIME-preservation fix) is accepted alongside raw base64.
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": f"data:image/png;base64,{TINY_PNG}"},
    )
    assert r.status_code == 200


async def test_submit_homework_403_for_outsider(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["outsider_token"]),
        json={"image_base64": TINY_PNG},
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
        json={"image_base64": TINY_PNG},
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
        json={"image_base64": TINY_PNG},
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
        json={"image_base64": TINY_PNG},
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
        json={"image_base64": TINY_PNG},
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
    assert out["image_data"]


async def test_teacher_submission_detail_403_for_other_teacher(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # First, the real teacher submits something
    submit_resp = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": TINY_PNG},
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
        json={"image_base64": TINY_PNG},
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
