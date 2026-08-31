"""Handwriting extraction quality — scoring the Vision read.

`GET /v1/admin/extraction-quality` reports how well `image_extract` reads
a photo of handwritten work, judged by the student who wrote the page.

The load-bearing rules pinned here:

- A submission the student never ruled on is AWAITING and is EXCLUDED
  from the rate. Counting an unanswered confirm as a pass would inflate
  the score with submissions nobody has looked at — the same defect that
  made the old Solution-quality page announce a verdict from no data.
- A cleared row (empty-string edit) is a DELETION, not "no change". The
  overlay drops it, so the report must not render it as untouched.
- Non-admin tokens get 403.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.course import Course
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers

pytestmark = pytest.mark.asyncio

URL = "/v1/admin/extraction-quality"


async def _wipe() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE submissions, assignments, sections, units, courses, "
            "users RESTART IDENTITY CASCADE"
        ))
        await s.commit()


def _extraction(*steps: tuple[int, int, str]) -> dict[str, Any]:
    """Vision output shaped the way the real pipeline writes it: steps
    carry `latex` (the transcription), keyed by problem_position+step_num."""
    return {
        "steps": [
            {
                "problem_position": pos,
                "step_num": num,
                "latex": text_,
                "plain_english": "",
            }
            for pos, num, text_ in steps
        ],
        "final_answers": [],
        # One float for the whole read — steps carry none of their own.
        "confidence": 0.8,
    }


@pytest.fixture
async def seeded() -> dict[str, Any]:
    """Four submissions covering every bucket: one read clean, one the
    student corrected, one they flagged, and one they never ruled on."""
    await _wipe()
    now = datetime.now(UTC)
    recent = now - timedelta(hours=1)

    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=99,
            role="admin", name="Admin",
        )
        teacher = User(
            email=f"t_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Teacher",
        )
        student = User(
            email=f"s_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=8,
            role="student", name="Student",
        )
        s.add_all([admin, teacher, student])
        await s.flush()

        course = Course(name="Algebra I", subject="math")
        s.add(course)
        await s.flush()

        unit = Unit(course_id=course.id, name="U", position=0)
        section = Section(course_id=course.id, name="P1")
        s.add_all([unit, section])
        await s.flush()

        asg = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW", type="homework", status="published",
            content={"problems": []},
        )
        s.add(asg)
        await s.flush()

        def _sub(**kw: Any) -> Submission:
            return Submission(
                assignment_id=asg.id, student_id=student.id,
                section_id=section.id, status="submitted",
                submitted_at=recent, **kw,
            )

        # Each student needs their own submission row — the table is
        # unique on (assignment, student), so four buckets need four
        # students rather than four rows for one.
        subs = []
        for i, kw in enumerate([
            # clean: confirmed, nothing edited
            {"extraction": _extraction((1, 1, "x + 3 = 7")),
             "extraction_confirmed_at": recent},
            # repaired: confirmed after correcting a row
            {"extraction": _extraction((1, 1, "(x + 2)(x + 3)")),
             "extraction_edits": {"1:1": "(x + z)(x + 3)"},
             "extraction_edited_at": recent,
             "extraction_confirmed_at": recent},
            # flagged: student rejected the read
            {"extraction": _extraction((1, 1, "illegible")),
             "extraction_flagged_at": recent},
            # awaiting: AI read it, student never ruled
            {"extraction": _extraction((1, 1, "2y = 8"))},
        ]):
            kid = User(
                email=f"s{i}_{uuid.uuid4().hex[:6]}@t.com",
                password_hash=hash_password("x"), grade_level=8,
                role="student", name=f"Student {i}",
            )
            s.add(kid)
            await s.flush()
            sub = _sub(**kw)
            sub.student_id = kid.id
            subs.append(sub)
        s.add_all(subs)
        await s.commit()

        return {
            "admin_token": create_access_token(str(admin.id), "admin"),
            "student_token": create_access_token(str(student.id), "student"),
            "clean_id": str(subs[0].id),
            "repaired_id": str(subs[1].id),
        }


async def test_buckets_split_and_awaiting_is_excluded_from_the_rate(
    seeded: dict[str, Any], client: AsyncClient,
) -> None:
    """The rate is over SETTLED submissions only. Three settled, one of
    them clean, so 33.3% — not 25%, which is what folding the untouched
    fourth in as a failure would give, and not 50%, which is what
    counting it as a pass would give."""
    r = await client.get(URL, headers=auth_headers(seeded["admin_token"]))
    assert r.status_code == 200, r.text
    summary = r.json()["summary"]

    assert summary["settled"] == 3
    assert summary["clean"] == 1
    assert summary["repaired"] == 1
    assert summary["flagged"] == 1
    assert summary["awaiting"] == 1
    assert summary["clean_rate"] == 33.3


async def test_the_list_puts_the_rows_worth_debugging_first(
    seeded: dict[str, Any], client: AsyncClient,
) -> None:
    """A clean read has nothing to diagnose. Flagged outranks repaired
    outranks clean, regardless of recency."""
    r = await client.get(URL, headers=auth_headers(seeded["admin_token"]))
    assert r.status_code == 200, r.text
    buckets = [c["bucket"] for c in r.json()["cases"]]
    assert buckets == ["flagged", "repaired", "clean"]


async def test_bucket_filter_narrows_the_list_but_not_the_headline(
    seeded: dict[str, Any], client: AsyncClient,
) -> None:
    """Filtering the list must not move the summary — otherwise the
    headline changes meaning depending on which filter is active."""
    r = await client.get(
        URL, params={"bucket": "flagged"},
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert [c["bucket"] for c in body["cases"]] == ["flagged"]
    assert body["total_count"] == 1
    # Unchanged by the filter.
    assert body["summary"]["settled"] == 3
    assert body["summary"]["clean_rate"] == 33.3


async def test_drill_in_pairs_the_read_against_the_correction(
    seeded: dict[str, Any], client: AsyncClient,
) -> None:
    """The diff is the whole diagnostic — a count tells you the reader is
    struggling, only this tells you how."""
    r = await client.get(
        f"{URL}/{seeded['repaired_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["bucket"] == "repaired"

    row = next(x for x in body["rows"] if x["key"] == "1:1")
    assert row["changed"] is True
    assert row["deleted"] is False
    # Read from `latex`, where Vision writes a maths transcription. If the
    # endpoint read a `text` field it would be None here.
    assert row["ai_read"] == "(x + 2)(x + 3)"
    assert row["student_said"] == "(x + z)(x + 3)"


async def test_a_cleared_row_reads_as_a_deletion_not_no_change(
    seeded: dict[str, Any], client: AsyncClient,
) -> None:
    """An empty-string edit means the student wiped the row and the
    overlay drops it. Reporting that as untouched would hide a total
    misread on the one screen built to surface misreads."""
    async with get_session_factory()() as s:
        sub = (await s.execute(
            Submission.__table__.select().where(
                Submission.id == uuid.UUID(seeded["repaired_id"]),
            )
        )).first()
        assert sub is not None
        await s.execute(
            Submission.__table__.update()
            .where(Submission.id == uuid.UUID(seeded["repaired_id"]))
            .values(extraction_edits={"1:1": ""})
        )
        await s.commit()

    r = await client.get(
        f"{URL}/{seeded['repaired_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 200, r.text
    row = next(x for x in r.json()["rows"] if x["key"] == "1:1")
    assert row["changed"] is True
    assert row["deleted"] is True


async def test_a_read_that_found_nothing_is_not_clean(
    seeded: dict[str, Any], client: AsyncClient,
) -> None:
    """The worst defect this page could have. `extract_student_work`
    returns {"steps": [], "final_answers": [], "confidence": 0.0} when it
    cannot read the files, and the confirm button is unconditional — so a
    student can tap "Looks right" on a screen saying nothing was read.
    Counted as clean, the total failure would inflate the headline."""
    async with get_session_factory()() as s:
        await s.execute(
            Submission.__table__.update()
            .where(Submission.id == uuid.UUID(seeded["clean_id"]))
            .values(extraction={
                "steps": [], "final_answers": [], "confidence": 0.0,
            })
        )
        await s.commit()

    r = await client.get(URL, headers=auth_headers(seeded["admin_token"]))
    assert r.status_code == 200, r.text
    summary = r.json()["summary"]
    # The confirmed-but-empty read moved out of clean into its own bucket.
    assert summary["empty"] == 1
    assert summary["clean"] == 0
    assert summary["settled"] == 3
    assert summary["clean_rate"] == 0.0


async def test_a_thin_sample_is_flagged_rather_than_coloured(
    seeded: dict[str, Any], client: AsyncClient,
) -> None:
    """Three settled reads cannot support a percentage. The response says
    so so the UI can caveat instead of painting a health colour on noise."""
    r = await client.get(URL, headers=auth_headers(seeded["admin_token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["summary"]["thin"] is True
    assert all(row["thin"] is True for row in body["by_subject"])


async def test_an_unknown_bucket_is_rejected_not_ignored(
    seeded: dict[str, Any], client: AsyncClient,
) -> None:
    """Silently ignoring it returns the UNFILTERED list, which reads as
    'no such cases exist' — the opposite of the truth."""
    r = await client.get(
        URL, params={"bucket": "nonsense"},
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 400, r.text


async def test_reading_a_students_work_is_logged(
    seeded: dict[str, Any], client: AsyncClient,
) -> None:
    """The drill-in returns a photograph of the student's handwriting.
    Every other read of a student record here is logged for FERPA
    disclosure-tracking; an admin reading any student across every school
    is a wider disclosure than a teacher reading their own."""
    from api.models.student_record_access_log import StudentRecordAccessLog

    r = await client.get(
        f"{URL}/{seeded['repaired_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 200, r.text

    async with get_session_factory()() as s:
        logs = list((await s.execute(
            StudentRecordAccessLog.__table__.select()
        )).all())
    assert len(logs) == 1
    assert logs[0].record_type == "extraction_quality_drill_in"
    assert logs[0].accessor_role == "admin"


async def test_students_cannot_read_the_report(
    seeded: dict[str, Any], client: AsyncClient,
) -> None:
    r = await client.get(URL, headers=auth_headers(seeded["student_token"]))
    assert r.status_code == 403, r.text
