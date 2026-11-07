"""Retaking the photos of a flagged, ungraded turn-in.

Submit is one-shot so a student can't resubmit after seeing feedback.
The retake is the narrow exception for a student who sent the reading to
the teacher because the photos were the problem: once, while nothing of
any kind has been graded, while the homework still takes turn-ins — and
without destroying the original, which the teacher can still see.
"""

from __future__ import annotations

import base64
import io
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select, text

from api.database import get_session_factory
from api.models.assignment import Submission, SubmissionGrade
from api.models.integrity_check import IntegrityCheckSubmission
from api.routes.school_student_practice import drain_integrity_background_tasks
from tests.conftest import PAGE_PNG


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _jpeg(size: tuple[int, int]) -> str:
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


NEW_PAGE = _jpeg((1200, 1600))


async def _submit_and_flag(
    client: AsyncClient, world: dict[str, Any], note: str = "Page 1 was sideways",
) -> str:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [PAGE_PNG]},
    )
    assert r.status_code == 200, r.text
    await drain_integrity_background_tasks()
    sid = r.json()["submission_id"]
    r = await client.post(
        f"/v1/school/student/submissions/{sid}/flag-extraction",
        headers=_auth(world["student_token"]),
        json={"note": note},
    )
    assert r.status_code == 200, r.text
    return str(sid)


async def _retake(
    client: AsyncClient, world: dict[str, Any], sid: str, **body: Any,
) -> Any:
    r = await client.post(
        f"/v1/school/student/submissions/{sid}/retake",
        headers=_auth(body.pop("token", world["student_token"])),
        json={"files": [NEW_PAGE, NEW_PAGE], **body},
    )
    await drain_integrity_background_tasks()
    return r


async def _row(sid: str) -> Submission:
    from sqlalchemy.orm import undefer

    async with get_session_factory()() as s:
        return (await s.execute(
            select(Submission)
            .options(undefer(Submission.retake_original))
            .where(Submission.id == uuid.UUID(sid))
        )).scalar_one()


async def _can_retake(client: AsyncClient, world: dict[str, Any]) -> bool:
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/submission",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    return bool(r.json()["can_retake"])


async def test_retake_replaces_the_photos_reads_them_again_and_keeps_the_original(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    sid = await _submit_and_flag(client, world)
    before = await _row(sid)
    assert await _can_retake(client, world) is True

    r = await _retake(
        client, world, sid,
        rotations=[90, 0], orientations=["rotated", "upright"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["submission_id"] == sid
    assert r.json()["is_late"] is False

    after = await _row(sid)
    # The new turn-in, back at the start of the normal path: a fresh
    # reading (the mocked extractor ran again) for the student to check.
    assert len(after.files or []) == 2
    assert after.extraction is not None
    assert after.extraction_flagged_at is None
    assert after.extraction_flag_note is None
    assert after.extraction_confirmed_at is None
    assert after.retaken_at is not None
    assert after.submitted_at > before.submitted_at
    # The page turned on the upload screen is stored turned, as at submit.
    turned = Image.open(io.BytesIO(base64.b64decode((after.files or [])[0]["data"])))
    assert turned.size == (1600, 1200)
    # Nothing destroyed: the original turn-in, whole.
    original = after.retake_original or {}
    assert original["files"] == before.files
    assert original["extraction"] == before.extraction
    assert original["extraction_flag_note"] == "Page 1 was sideways"
    assert original["extraction_flagged_at"] is not None
    assert original["submitted_at"] == before.submitted_at.isoformat()
    assert original["is_late"] is False

    # Once only.
    assert await _can_retake(client, world) is False

    async with get_session_factory()() as s:
        [meta] = (await s.execute(text(
            "SELECT action_metadata FROM activity_log WHERE action = 'submission.retake'"
        ))).scalars().all()
    assert meta["file_count"] == 2
    assert meta["previous_file_count"] == 1
    assert meta["page_orientations"] == ["rotated", "upright"]
    assert meta["is_late"] is False


async def test_the_new_reading_can_be_confirmed_and_graded_normally(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The retake hands the work back to the normal path — the locked
    rule is that a FLAGGED reading is never AI-graded, and this one no
    longer is."""
    sid = await _submit_and_flag(client, world)
    assert (await _retake(client, world, sid)).status_code == 200
    r = await client.post(
        f"/v1/school/student/submissions/{sid}/confirm-extraction",
        headers=_auth(world["student_token"]),
    )
    await drain_integrity_background_tasks()
    assert r.status_code == 200, r.text
    assert (await _row(sid)).extraction_confirmed_at is not None


async def test_only_once(client: AsyncClient, world: dict[str, Any]) -> None:
    sid = await _submit_and_flag(client, world)
    assert (await _retake(client, world, sid)).status_code == 200
    # Flag the new reading too: still no second retake.
    r = await client.post(
        f"/v1/school/student/submissions/{sid}/flag-extraction",
        headers=_auth(world["student_token"]),
        json={"note": "still wrong"},
    )
    assert r.status_code == 200
    assert await _can_retake(client, world) is False
    r = await _retake(client, world, sid)
    assert r.status_code == 409
    assert "already" in r.json()["detail"]


async def test_only_a_flagged_reading(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [PAGE_PNG]},
    )
    await drain_integrity_background_tasks()
    sid = r.json()["submission_id"]
    assert await _can_retake(client, world) is False
    assert (await _retake(client, world, sid)).status_code == 409

    # Nor after confirming it — feedback may already be on its way.
    await client.post(
        f"/v1/school/student/submissions/{sid}/confirm-extraction",
        headers=_auth(world["student_token"]),
    )
    await drain_integrity_background_tasks()
    assert (await _retake(client, world, sid)).status_code == 409


async def test_not_once_the_teacher_has_started_grading(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A single hand-scored problem is grade data: those photos are now
    the ones being graded. (A note alone isn't a grade.)"""
    sid = await _submit_and_flag(client, world)
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(submission_id=uuid.UUID(sid), teacher_notes="looking"))
        await s.commit()
    assert await _can_retake(client, world) is True

    async with get_session_factory()() as s:
        await s.execute(text(
            "UPDATE submission_grades SET breakdown = :b, final_score = 100 "
            "WHERE submission_id = :id"
        ), {"b": '[{"problem_id": "x", "score_status": "full", "percent": 100}]', "id": sid})
        await s.commit()
    assert await _can_retake(client, world) is False
    r = await _retake(client, world, sid)
    assert r.status_code == 409
    assert "grading" in r.json()["detail"]
    # Untouched.
    row = await _row(sid)
    assert row.extraction_flagged_at is not None
    assert row.retaken_at is None


async def test_not_once_an_understanding_check_exists(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    sid = await _submit_and_flag(client, world)
    async with get_session_factory()() as s:
        s.add(IntegrityCheckSubmission(submission_id=uuid.UUID(sid), status="awaiting_student"))
        await s.commit()
    assert (await _retake(client, world, sid)).status_code == 409


async def test_held_to_submits_file_rules(client: AsyncClient, world: dict[str, Any]) -> None:
    """Same validation as the first turn-in, and a refused retake changes
    nothing."""
    sid = await _submit_and_flag(client, world)
    r = await client.post(
        f"/v1/school/student/submissions/{sid}/retake",
        headers=_auth(world["student_token"]),
        json={"files": [_jpeg((320, 240))]},
    )
    assert r.status_code == 400
    assert "too small" in r.json()["detail"]
    row = await _row(sid)
    assert row.extraction_flagged_at is not None
    assert row.retaken_at is None


async def test_only_the_student_who_turned_it_in(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    sid = await _submit_and_flag(client, world)
    r = await _retake(client, world, sid, token=world["outsider_token"])
    assert r.status_code == 403


async def test_not_once_the_homework_no_longer_takes_turn_ins(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    sid = await _submit_and_flag(client, world)
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET status = 'draft' WHERE id = :id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()
    assert await _can_retake(client, world) is False
    assert (await _retake(client, world, sid)).status_code == 403


async def test_not_offered_to_a_student_who_left_the_class(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The offer goes through the endpoint's own enrollment gate, so a
    student is never asked to retake every page only to be refused."""
    sid = await _submit_and_flag(client, world)
    assert await _can_retake(client, world) is True
    async with get_session_factory()() as s:
        await s.execute(
            text("DELETE FROM section_enrollments WHERE student_id = :id"),
            {"id": world["student_id"]},
        )
        await s.commit()
    assert await _can_retake(client, world) is False
    assert (await _retake(client, world, sid)).status_code == 403


async def test_a_retake_past_due_is_late_and_cant_launder_a_late_original(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    sid = await _submit_and_flag(client, world)
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET due_at = :d WHERE id = :id"),
            {"d": datetime.now(UTC) - timedelta(hours=1), "id": world["assignment_id"]},
        )
        await s.commit()
    r = await _retake(client, world, sid)
    assert r.status_code == 200
    assert r.json()["is_late"] is True
    row = await _row(sid)
    assert row.is_late is True
    assert (row.retake_original or {})["is_late"] is False

    # A late original stays late, even if the due date has since moved.
    async with get_session_factory()() as s:
        await s.execute(text(
            "UPDATE submissions SET is_late = true, retaken_at = NULL, retake_original = NULL, "
            "extraction_flagged_at = now() WHERE id = :id"
        ), {"id": sid})
        await s.execute(
            text("UPDATE assignments SET due_at = :d WHERE id = :id"),
            {"d": datetime.now(UTC) + timedelta(days=1), "id": world["assignment_id"]},
        )
        await s.commit()
    r = await _retake(client, world, sid)
    assert r.status_code == 200
    assert r.json()["is_late"] is True


async def test_the_teacher_sees_the_retake_and_the_original(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    sid = await _submit_and_flag(client, world)
    r = await client.get(f"/v1/teacher/submissions/{sid}", headers=_auth(world["teacher_token"]))
    assert r.json()["retaken_at"] is None
    assert r.json()["retake_original"] is None

    assert (await _retake(client, world, sid)).status_code == 200
    r = await client.get(f"/v1/teacher/submissions/{sid}", headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["retaken_at"] is not None
    assert len(body["files"]) == 2
    original = body["retake_original"]
    assert len(original["files"]) == 1
    assert original["files"][0]["data"] == PAGE_PNG
    assert original["extraction_flag_note"] == "Page 1 was sideways"
    assert original["extraction_flagged_at"] is not None
    assert original["submitted_at"] is not None
    # The new reading is not flagged.
    assert body["extraction_flagged_at"] is None
