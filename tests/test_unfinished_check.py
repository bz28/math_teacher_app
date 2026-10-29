"""The "didn't finish the check" teacher marker, the flagged count, and
the migration that backfills it.

One submission per state the roster has to tell apart, seeded straight
into the tables (no LLM): the check ran and was abandoned before or after
the student answered, it hit the turn cap, the photo was unreadable, the
student never confirmed the reading (stale and fresh), or the student
disputed the reading.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select, text

from api.core.auth import hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission
from api.models.course import CourseTeacher
from api.models.integrity_check import (
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from tests.conftest import auth_headers as _auth

EXTRACTION = {"confidence": 0.9, "steps": [], "final_answers": []}
STALE = timedelta(hours=13)


async def _seed(world: dict[str, Any]) -> dict[str, uuid.UUID]:
    """Returns submission id by state name."""
    now = datetime.now(UTC)
    async with get_session_factory()() as s:
        a = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        section_id = (await s.execute(
            select(AssignmentSection.section_id)
            .where(AssignmentSection.assignment_id == a.id)
        )).scalar_one()

        subs: dict[str, uuid.UUID] = {}

        async def student_sub(name: str, **kw: Any) -> Submission:
            u = User(
                email=f"{name}_{uuid.uuid4().hex[:6]}@s.edu",
                password_hash=hash_password("x"), grade_level=8,
                role="student", name=name,
            )
            s.add(u)
            await s.flush()
            s.add(SectionEnrollment(
                section_id=section_id, course_id=a.course_id, student_id=u.id,
            ))
            sub = Submission(
                assignment_id=a.id, student_id=u.id, section_id=section_id,
                status="submitted", extraction=EXTRACTION,
                submitted_at=now - STALE, **kw,
            )
            s.add(sub)
            await s.flush()
            subs[name] = sub.id
            return sub

        for name, reason in (
            ("not_started", "not_started"),
            ("left_partway", "left_partway"),
            ("turn_cap", "turn_cap"),
        ):
            sub = await student_sub(name, extraction_confirmed_at=now - STALE)
            s.add(IntegrityCheckSubmission(
                submission_id=sub.id, status="complete",
                disposition=None, incomplete_reason=reason,
            ))
        sub = await student_sub("unreadable", extraction_confirmed_at=now - STALE)
        s.add(IntegrityCheckSubmission(
            submission_id=sub.id, status="skipped_unreadable",
        ))
        await student_sub("never_confirmed")
        fresh = await student_sub("fresh_unconfirmed")
        fresh.submitted_at = now - timedelta(minutes=10)
        await student_sub("disputed", extraction_flagged_at=now - STALE)
        await s.commit()
    return subs


async def _rows(client: AsyncClient, world: dict[str, Any]) -> dict[str, dict[str, Any]]:
    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/submissions",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    return {row["id"]: row for row in r.json()["submissions"]}


async def test_roster_marks_each_unfinished_state(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    subs = await _seed(world)
    rows = await _rows(client, world)

    def state(name: str) -> Any:
        return rows[str(subs[name])]["unfinished_check"]

    assert state("not_started") == "not_started"
    assert state("left_partway") == "left_partway"
    assert state("never_confirmed") == "never_confirmed"
    # The student stayed to the cap: inconclusive, not "didn't finish".
    assert state("turn_cap") is None
    # Ten minutes after turning in, they may be confirming right now.
    assert state("fresh_unconfirmed") is None
    # A disputed reading has its own state; no check was meant to run.
    assert state("disputed") is None
    assert state("unreadable") is None

    def reason(name: str) -> Any:
        ov = rows[str(subs[name])]["integrity_overview"]
        return ov and ov["incomplete_reason"]

    assert reason("turn_cap") == "turn_cap"
    assert reason("unreadable") == "unreadable"
    assert reason("not_started") == "not_started"


async def test_never_confirmed_needs_the_check_switched_on(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """With the check off, an unconfirmed reading isn't a missed check."""
    subs = await _seed(world)
    async with get_session_factory()() as s:
        a = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        a.integrity_check_enabled = False
        await s.commit()
    rows = await _rows(client, world)
    assert rows[str(subs["never_confirmed"])]["unfinished_check"] is None


async def test_inbox_flagged_count_matches_roster_filter(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The inbox's "N flagged" counts exactly the rows the review page's
    Flagged filter lists: turn cap, unreadable, disputed. Didn't-finish
    rows are marked on the roster but never flagged."""
    await _seed(world)
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            select(Assignment.course_id)
            .where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        # `world` seeds the course without a co-teacher row; the inbox is
        # gated on course membership.
        s.add(CourseTeacher(
            course_id=course_id, teacher_id=world["teacher_id"], role="owner",
        ))
        await s.commit()
    r = await client.get(
        f"/v1/teacher/courses/{course_id}/submissions-inbox",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    (row,) = [x for x in r.json()["rows"] if x["assignment_id"] == str(world["assignment_id"])]
    assert row["flagged"] == 3


# ── Migration backfill ──

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "api" / "alembic" / "versions"
    / "cz1000095_add_integrity_incomplete_reason.py"
)


def _backfill_sql() -> list[str]:
    """The UPDATEs as the migration ships them, so the test can't drift."""
    body = MIGRATION.read_text().split("def upgrade()", 1)[1].split("def downgrade()")[0]
    stmts = re.findall(r'"""(.*?)"""', body, re.DOTALL)
    assert len(stmts) == 2 and all("UPDATE" in q for q in stmts), stmts
    return stmts


async def test_migration_backfills_existing_rows(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Rows written before the column existed carry their reason only in
    the fixed copy the force-finalizes wrote. The backfill recovers it —
    and leaves the agent's own verdicts alone."""
    subs = await _seed(world)
    async with get_session_factory()() as s:
        checks = {
            c.submission_id: c for c in (await s.execute(
                select(IntegrityCheckSubmission)
            )).scalars().all()
        }
        # Rewind every row to its pre-migration shape.
        for c in checks.values():
            c.incomplete_reason = None
        checks[subs["not_started"]].headline = "Interview incomplete"
        partway = checks[subs["left_partway"]]
        partway.headline = "Interview incomplete"
        s.add(IntegrityConversationTurn(
            integrity_check_submission_id=partway.id, ordinal=0,
            role="agent", content="Opener.",
        ))
        s.add(IntegrityConversationTurn(
            integrity_check_submission_id=partway.id, ordinal=1,
            role="student", content="I factored it.",
        ))
        checks[subs["turn_cap"]].overall_summary = (
            "Conversation hit the turn cap — inconclusive. Teacher review."
        )
        verdict = checks[subs["unreadable"]]
        verdict.status = "complete"
        verdict.disposition = "pass"
        verdict.headline = "Interview incomplete"  # can't happen; proves the guard
        await s.commit()

    async with get_session_factory()() as s:
        for stmt in _backfill_sql():
            await s.execute(text(stmt))
        await s.commit()

    async with get_session_factory()() as s:
        got = {
            c.submission_id: c.incomplete_reason for c in (await s.execute(
                select(IntegrityCheckSubmission)
            )).scalars().all()
        }
    assert got[subs["not_started"]] == "not_started"
    assert got[subs["left_partway"]] == "left_partway"
    assert got[subs["turn_cap"]] == "turn_cap"
    assert got[subs["unreadable"]] is None
