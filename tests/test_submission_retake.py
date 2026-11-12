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
from api.models.assignment import Submission, SubmissionAttempt, SubmissionGrade
from api.models.integrity_check import IntegrityCheckSubmission
from api.routes.school_student_practice import drain_integrity_background_tasks
from tests.conftest import PAGE_PNG
from tests.test_student_activity_events import _assert_meta_contract


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
    async with get_session_factory()() as s:
        return (await s.execute(
            select(Submission).where(Submission.id == uuid.UUID(sid))
        )).scalar_one()


async def _attempts(sid: str) -> list[SubmissionAttempt]:
    """The turn-ins kept for this submission, oldest first, pages and all."""
    from sqlalchemy.orm import undefer

    async with get_session_factory()() as s:
        return list((await s.execute(
            select(SubmissionAttempt)
            .options(
                undefer(SubmissionAttempt.files),
                undefer(SubmissionAttempt.extraction),
                undefer(SubmissionAttempt.extraction_edits),
                undefer(SubmissionAttempt.integrity),
            )
            .where(SubmissionAttempt.submission_id == uuid.UUID(sid))
            .order_by(SubmissionAttempt.number)
        )).scalars().all())


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
    # Nothing destroyed: the original turn-in, whole, as attempt 1.
    [original] = await _attempts(sid)
    assert original.number == 1
    assert original.reason == "retake"
    assert original.files == before.files
    assert original.extraction == before.extraction
    assert original.extraction_flag_note == "Page 1 was sideways"
    assert original.extraction_flagged_at == before.extraction_flagged_at
    assert original.submitted_at == before.submitted_at
    assert original.is_late is False
    assert original.replaced_at == after.retaken_at
    # Nothing was graded, so there's no grade to keep.
    assert original.grade is None
    assert original.integrity is None

    # Once only.
    assert await _can_retake(client, world) is False

    async with get_session_factory()() as s:
        [meta] = (await s.execute(text(
            "SELECT action_metadata FROM activity_log WHERE action = 'submission.retake'"
        ))).scalars().all()
    _assert_meta_contract(meta)
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
    """Backstop: a flagged reading never starts a check, so this row is
    hand-inserted. The real path is the next test."""
    sid = await _submit_and_flag(client, world)
    async with get_session_factory()() as s:
        s.add(IntegrityCheckSubmission(submission_id=uuid.UUID(sid), status="awaiting_student"))
        await s.commit()
    assert (await _retake(client, world, sid)).status_code == 409


async def test_not_after_a_real_confirm_started_the_understanding_check(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The real way a check comes to exist: the student confirms the
    reading, the check opens. Those photos are now the ones the student
    is explaining — no retake, and none offered."""
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [PAGE_PNG]},
    )
    await drain_integrity_background_tasks()
    sid = r.json()["submission_id"]
    r = await client.post(
        f"/v1/school/student/submissions/{sid}/confirm-extraction",
        headers=_auth(world["student_token"]),
    )
    await drain_integrity_background_tasks()
    assert r.status_code == 200, r.text
    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission.id)
            .where(IntegrityCheckSubmission.submission_id == uuid.UUID(sid))
        )).scalar_one_or_none()
    assert check is not None, "confirm should have opened the understanding check"
    assert await _can_retake(client, world) is False
    assert (await _retake(client, world, sid)).status_code == 409
    assert (await _row(sid)).retaken_at is None


# ── Races: the state changes while the new photos are being validated ──
#
# `_retake_block` approves the retake before the photos are validated,
# which can take seconds on a large upload. The write itself re-checks
# every rule, so whatever lands in that window wins and the retake gets
# a 409 with the row untouched.


def _during_validation(monkeypatch: Any, side_effect: Any) -> None:
    """Run `side_effect` while the retake is validating its photos."""
    import api.routes.school_student_practice as route

    real = route._validated_upload_files

    async def validating(body: Any) -> Any:
        files = await real(body)
        await side_effect()
        return files

    monkeypatch.setattr(route, "_validated_upload_files", validating)


async def _assert_untouched(sid: str) -> None:
    row = await _row(sid)
    assert row.extraction_flagged_at is not None
    assert row.retaken_at is None
    assert await _attempts(sid) == []
    assert len(row.files or []) == 1


async def test_a_grade_saved_while_validating_wins(
    client: AsyncClient, world: dict[str, Any], monkeypatch: Any,
) -> None:
    sid = await _submit_and_flag(client, world)

    async def teacher_grades() -> None:
        async with get_session_factory()() as s:
            s.add(SubmissionGrade(
                submission_id=uuid.UUID(sid),
                breakdown=[{"problem_id": "x", "score_status": "full", "percent": 100}],
                final_score=100,
            ))
            await s.commit()

    _during_validation(monkeypatch, teacher_grades)
    r = await _retake(client, world, sid)
    assert r.status_code == 409, r.text
    await _assert_untouched(sid)


async def test_a_note_saved_while_validating_doesnt_block(
    client: AsyncClient, world: dict[str, Any], monkeypatch: Any,
) -> None:
    """The guard matches `has_any_grade`, not "a grade row exists"."""
    sid = await _submit_and_flag(client, world)

    async def teacher_notes() -> None:
        async with get_session_factory()() as s:
            s.add(SubmissionGrade(submission_id=uuid.UUID(sid), teacher_notes="looking",
                                  breakdown=[]))
            await s.commit()

    _during_validation(monkeypatch, teacher_notes)
    assert (await _retake(client, world, sid)).status_code == 200


async def test_an_understanding_check_opened_while_validating_wins(
    client: AsyncClient, world: dict[str, Any], monkeypatch: Any,
) -> None:
    sid = await _submit_and_flag(client, world)

    async def check_opens() -> None:
        async with get_session_factory()() as s:
            s.add(IntegrityCheckSubmission(submission_id=uuid.UUID(sid), status="awaiting_student"))
            await s.commit()

    _during_validation(monkeypatch, check_opens)
    assert (await _retake(client, world, sid)).status_code == 409
    await _assert_untouched(sid)


async def test_a_confirm_racing_a_retake_cant_also_win(
    client: AsyncClient, world: dict[str, Any], monkeypatch: Any,
) -> None:
    """A confirm from another tab, landing mid-retake, is refused: the
    reading is still flagged, and flag and confirm are exclusive (a DB
    check constraint). The retake then goes through on its own."""
    sid = await _submit_and_flag(client, world)
    confirm_status: list[int] = []

    async def other_tab_confirms() -> None:
        r = await client.post(
            f"/v1/school/student/submissions/{sid}/confirm-extraction",
            headers=_auth(world["student_token"]),
        )
        confirm_status.append(r.status_code)

    _during_validation(monkeypatch, other_tab_confirms)
    assert (await _retake(client, world, sid)).status_code == 200
    assert confirm_status == [409]
    row = await _row(sid)
    assert row.extraction_confirmed_at is None
    assert row.retaken_at is not None


async def test_two_retakes_at_once_only_one_lands(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A double tap, or two devices: both pass `_retake_block`, only one
    write matches, and the original kept is the real first turn-in."""
    import asyncio

    sid = await _submit_and_flag(client, world)
    before = await _row(sid)
    r1, r2 = await asyncio.gather(_retake(client, world, sid), _retake(client, world, sid))
    assert sorted([r1.status_code, r2.status_code]) == [200, 409]
    [original] = await _attempts(sid)
    assert original.files == before.files


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


async def test_a_retake_past_due_is_late_against_the_current_due_date(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Lateness is the new photos' own, against the due date as it is now.
    They always arrive after the ones they replace, so a retake can only
    add lateness, never launder it."""
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
    [original] = await _attempts(sid)
    assert original.is_late is False


async def test_the_teacher_sees_the_retake_and_the_original(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    sid = await _submit_and_flag(client, world)
    r = await client.get(f"/v1/teacher/submissions/{sid}", headers=_auth(world["teacher_token"]))
    assert r.json()["retaken_at"] is None
    assert r.json()["attempts"] == []
    originals_url = f"/v1/teacher/submissions/{sid}/attempts/1/files"
    r = await client.get(originals_url, headers=_auth(world["teacher_token"]))
    assert r.status_code == 404

    assert (await _retake(client, world, sid)).status_code == 200
    r = await client.get(f"/v1/teacher/submissions/{sid}", headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["retaken_at"] is not None
    assert len(body["files"]) == 2
    [original] = body["attempts"]
    assert original["number"] == 1
    assert original["reason"] == "retake"
    assert original["final_score"] is None
    # The detail carries the callout's facts, not a second set of pages —
    # it's re-fetched often; the photos load when she opens them.
    assert original["file_count"] == 1
    assert "files" not in original
    assert original["extraction_flag_note"] == "Page 1 was sideways"
    assert original["extraction_flagged_at"] is not None
    assert original["submitted_at"] is not None
    # The new reading is not flagged.
    assert body["extraction_flagged_at"] is None

    r = await client.get(originals_url, headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    assert [f["data"] for f in r.json()["files"]] == [PAGE_PNG]
    # A student can't read them through the teacher route.
    r = await client.get(originals_url, headers=_auth(world["student_token"]))
    assert r.status_code in (401, 403)

    # An attempt whose files are JSON null still loads: 0 pages, no 500.
    async with get_session_factory()() as s:
        await s.execute(text(
            "UPDATE submission_attempts SET files = CAST('null' AS json) WHERE submission_id = :id"
        ), {"id": sid})
        await s.commit()
    r = await client.get(f"/v1/teacher/submissions/{sid}", headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    assert r.json()["attempts"][0]["file_count"] == 0
    # And an attempt that doesn't exist is a 404.
    r = await client.get(
        f"/v1/teacher/submissions/{sid}/attempts/2/files", headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 404


async def test_another_teacher_cant_see_the_originals_or_whether_there_are_any(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Ownership is checked before "was it retaken", so a teacher outside
    the class gets the same 403 either way — the status can't leak it."""
    from api.core.auth import create_access_token, hash_password
    from api.models.user import User

    async with get_session_factory()() as s:
        school_id = (await s.execute(
            select(User.school_id).where(User.id == world["teacher_id"])
        )).scalar_one()
        other = User(
            email=f"other_teacher_{uuid.uuid4().hex[:6]}@t.com", name="Other",
            password_hash=hash_password("x"), grade_level=12, role="teacher",
            school_id=school_id,
        )
        s.add(other)
        await s.commit()
        other_token = create_access_token(str(other.id), "teacher")

    sid = await _submit_and_flag(client, world)
    url = f"/v1/teacher/submissions/{sid}/attempts/1/files"
    r = await client.get(url, headers=_auth(other_token))
    assert r.status_code == 403, r.text  # not retaken: still 403, not 404
    assert (await _retake(client, world, sid)).status_code == 200
    r = await client.get(url, headers=_auth(other_token))
    assert r.status_code == 403, r.text
    # The owning teacher still gets them.
    r = await client.get(url, headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    # And an unknown submission is a plain 404.
    r = await client.get(
        f"/v1/teacher/submissions/{uuid.uuid4()}/attempts/1/files",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 404

