"""Fill a school with a lived-in Trig/Precalculus class to film a demo.

Three weeks into a trig unit: three homeworks, five students (fake_1 …
fake_5) in Period 2, handwritten photo turn-ins, the
reader's transcripts, AI-style grades and feedback, understanding-check
conversations, and the review state of a class mid-unit (see
`scripts/demo_school_content.py` for exactly what).

It makes NO model calls and writes no `llm_calls` rows: every "AI"
artifact is authored in demo_school_content.py and stored in the shapes
the app's own pipelines write. It sends no email.

Re-runnable: each run first removes what an earlier run made in that
school — the "Trig/Precalculus" course the teacher owns there and the
fake_N@demo-students.invalid students, with their photos — and builds it
again. It refuses, changing nothing, if a real student is on that
course, if a fake_N email belongs to another school, or if the teacher
isn't a teacher of that school. The teacher, their preview student,
other courses, other schools and real students are never touched.

    # Dry run (the default): everything in one transaction, printed, then
    # ROLLED BACK; photos uploaded on the way are deleted again.
    python scripts/seed_demo_school.py --school-id <uuid> --teacher-email <email>

    # Keep it.
    python scripts/seed_demo_school.py --school-id <uuid> --teacher-email <email> --commit

Settings come from the environment like the app's (DATABASE_URL,
PHOTO_BUCKET…). A `postgresql://` URL (Railway's public one) is accepted
and driven through asyncpg.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import secrets
import sys
import uuid
import zlib
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DISABLED_CLAUDE_KEY = "sk-ant-demo-seed-makes-no-model-calls"


def _asyncpg_url(url: str) -> str:
    """`postgres://` / `postgresql://` → `postgresql+asyncpg://`; libpq's
    sslmode query param (which asyncpg rejects) becomes asyncpg's ssl."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            url = "postgresql+asyncpg://" + url[len(prefix):]
    parts = urlsplit(url)
    query = []
    for k, v in parse_qsl(parts.query):
        query.append(("ssl", v) if k == "sslmode" else (k, v))
    return urlunsplit(parts._replace(query=urlencode(query)))


def _prepare_env() -> None:
    """Runs before `api` is imported, so its settings see this."""
    if os.environ.get("DATABASE_URL"):
        os.environ["DATABASE_URL"] = _asyncpg_url(os.environ["DATABASE_URL"])
    # Belt and braces: this script calls no model and sends no mail, and
    # with these any code path that tried would fail instead.
    os.environ["CLAUDE_API_KEY"] = DISABLED_CLAUDE_KEY
    os.environ["RESEND_API_KEY"] = ""
    os.environ["SENTRY_DSN"] = ""


if __name__ == "__main__":
    _prepare_env()

from sqlalchemy import func, or_, select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from api.config import settings  # noqa: E402
from api.core import photo_store  # noqa: E402
from api.core.auth import hash_password  # noqa: E402
from api.core.class_rubric import effective_rubric  # noqa: E402
from api.core.grading_ai import _build_breakdown  # noqa: E402
from api.core.homework_points import assignment_points  # noqa: E402
from api.core.integrity_pipeline import (  # noqa: E402
    _slice_extraction_for_problem,
    compute_activity_summary,
    select_probe_problem,
)
from api.core.late_policy import (  # noqa: E402
    LATE_POLICY_PENALTY_PER_DAY,
    days_late,
    penalty_percent,
    set_final_score,
)
from api.models.assignment import (  # noqa: E402
    Assignment,
    AssignmentSection,
    Submission,
    SubmissionGrade,
)
from api.models.course import Course, CourseTeacher  # noqa: E402
from api.models.integrity_check import (  # noqa: E402
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)
from api.models.llm_call import LLMCall  # noqa: E402
from api.models.question_bank import QuestionBankItem  # noqa: E402
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School  # noqa: E402
from api.models.section import Section  # noqa: E402
from api.models.section_enrollment import SectionEnrollment  # noqa: E402
from api.models.unit import Unit  # noqa: E402
from api.models.user import User  # noqa: E402
from api.routes.teacher_sections import (  # noqa: E402
    INVITE_EXPIRY_DAYS,
    _create_or_refresh_invite,
    _generate_unique_join_code,
)
from scripts.demo_school_content import (  # noqa: E402
    HOMEWORKS,
    SECTION_OF,
    STUDENTS,
    TURN_INS,
    Homework,
    TurnIn,
)
from scripts.demo_school_pages import WrittenProblem, render_pages, to_plain  # noqa: E402

COURSE_NAME = "Trig/Precalculus"
UNIT_NAMES = {4: "Unit 4 · Trigonometric Functions", 5: "Unit 5 · Trigonometric Equations"}
SECTION_NAMES = ("Period 2",)
INVITE_SECTION = "Period 2"
FAKE_DOMAIN = "demo-students.invalid"
# The demo is filmed in Eastern time; due dates read 11:59 PM there.
TEACHER_TZ = ZoneInfo("America/New_York")
FAKE_EMAILS = {name: f"{name}@{FAKE_DOMAIN}" for name in STUDENTS}


class RefusedError(Exception):
    """The school isn't in a state this script may change."""


@dataclass
class SeedReport:
    school_name: str = ""
    teacher_name: str = ""
    removed: list[str] = field(default_factory=list)
    created: dict[str, int] = field(default_factory=dict)
    course_id: uuid.UUID | None = None
    section_ids: dict[str, uuid.UUID] = field(default_factory=dict)
    assignment_ids: dict[str, uuid.UUID] = field(default_factory=dict)
    student_ids: dict[str, uuid.UUID] = field(default_factory=dict)
    submission_ids: dict[tuple[str, str], uuid.UUID] = field(default_factory=dict)
    join_codes: dict[str, str] = field(default_factory=dict)
    invite_email: str | None = None
    invite_token: str | None = None
    lines: list[str] = field(default_factory=list)
    # Photos uploaded by this run (delete them if it doesn't commit) and
    # the earlier run's (delete them only once it has).
    new_pages: list[dict[str, Any]] = field(default_factory=list)
    old_pages: list[dict[str, Any]] = field(default_factory=list)

    def bump(self, what: str, n: int = 1) -> None:
        self.created[what] = self.created.get(what, 0) + n


# ── Time ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Clock:
    """Times on the teacher's wall clock (`TEACHER_TZ`): homework goes out
    at 8:00 AM and is due at 11:59 PM, counted back from the most recent
    11:59 PM, so the dates read as a teacher would set them whenever this
    runs. Every value it returns is UTC."""

    now: datetime
    anchor: datetime  # the most recent 11:59 PM local, as a local time

    @classmethod
    def at(cls, now: datetime) -> Clock:
        local = now.astimezone(TEACHER_TZ)
        anchor = local.replace(hour=23, minute=59, second=0, microsecond=0)
        if anchor > local:
            anchor -= timedelta(days=1)
        return cls(now, anchor)

    def local(self, days_ago: int, hour: int, minute: int) -> datetime:
        day = self.anchor.date() - timedelta(days=days_ago)
        return datetime.combine(day, time(hour, minute), tzinfo=TEACHER_TZ).astimezone(UTC)

    def due(self, hw: Homework) -> datetime:
        return self.local(hw.due_days_ago, 23, 59)

    def published(self, hw: Homework) -> datetime:
        return self.local(hw.published_days_ago, 8, 0)

    def created(self, hw: Homework) -> datetime:
        # The evening before it went out.
        return self.local(hw.created_days_ago, 19, 15)

    def course_created(self) -> datetime:
        return self.local(30, 16, 47)


# ── Reset ────────────────────────────────────────────────────────────


async def _demo_courses(db: AsyncSession, school_id: uuid.UUID, teacher_id: uuid.UUID) -> list[Course]:
    return list((await db.execute(
        select(Course)
        .join(CourseTeacher, CourseTeacher.course_id == Course.id)
        .where(Course.school_id == school_id, Course.name == COURSE_NAME,
               CourseTeacher.teacher_id == teacher_id)
    )).scalars())


async def _check_and_reset(
    db: AsyncSession, school_id: uuid.UUID, teacher_email: str, report: SeedReport,
) -> tuple[School, User]:
    school = await db.get(School, school_id)
    if school is None:
        raise RefusedError(f"No school with id {school_id}.")
    if school.kind != SCHOOL_KIND_INSTITUTIONAL:
        raise RefusedError(f"School {school.name!r} is {school.kind!r}, not institutional.")
    teacher = (await db.execute(
        select(User).where(func.lower(User.email) == teacher_email.strip().lower())
    )).scalar_one_or_none()
    if teacher is None:
        raise RefusedError(f"No user with email {teacher_email!r}.")
    if teacher.role != "teacher" or teacher.school_id != school.id or teacher.is_preview:
        raise RefusedError(f"{teacher_email} is not a teacher of {school.name!r}.")
    report.school_name, report.teacher_name = school.name, teacher.name

    fakes = list((await db.execute(
        select(User).where(func.lower(User.email).in_(list(FAKE_EMAILS.values())))
    )).scalars())
    for u in fakes:
        if u.school_id != school.id or u.role != "student" or u.is_preview:
            raise RefusedError(f"{u.email} exists outside {school.name!r} (or isn't a plain student); not touching it.")
    fake_ids = {u.id for u in fakes}

    courses = await _demo_courses(db, school.id, teacher.id)
    for course in courses:
        others = (await db.execute(
            select(User.email)
            .join(SectionEnrollment, SectionEnrollment.student_id == User.id)
            .where(SectionEnrollment.course_id == course.id,
                   User.id.notin_(fake_ids),
                   or_(User.is_preview.is_(False), User.preview_owner_id != teacher.id))
        )).scalars().all()
        other_work = (await db.execute(
            select(func.count(Submission.id))
            .join(User, User.id == Submission.student_id)
            .join(Assignment, Assignment.id == Submission.assignment_id)
            .where(Assignment.course_id == course.id,
                   User.id.notin_(fake_ids),
                   or_(User.is_preview.is_(False), User.preview_owner_id != teacher.id))
        )).scalar_one()
        if others or other_work:
            raise RefusedError(
                f"{COURSE_NAME!r} ({course.id}) has students who aren't fake_N demo students "
                f"({len(others)} enrolled, {other_work} turn-ins). Remove them or rename the course first."
            )
    for u in fakes:
        elsewhere = (await db.execute(
            select(func.count(SectionEnrollment.id)).where(
                SectionEnrollment.student_id == u.id,
                SectionEnrollment.course_id.notin_([c.id for c in courses]),
            )
        )).scalar_one()
        if elsewhere:
            raise RefusedError(f"{u.email} is enrolled in another course; not touching it.")

    for course in courses:
        hw = (await db.execute(
            select(Assignment.title).where(Assignment.course_id == course.id).order_by(Assignment.created_at)
        )).scalars().all()
        subs = (await db.execute(
            select(func.count(Submission.id)).join(Assignment, Assignment.id == Submission.assignment_id)
            .where(Assignment.course_id == course.id)
        )).scalar_one()
        report.removed.append(
            f"course {course.name!r} {course.id}: {len(hw)} homework ({', '.join(hw) or 'none'}), {subs} turn-ins"
        )
        report.old_pages += await photo_store.pages_of_submissions(
            db,
            or_(
                Submission.assignment_id.in_(select(Assignment.id).where(Assignment.course_id == course.id)),
                Submission.section_id.in_(select(Section.id).where(Section.course_id == course.id)),
            ),
        )
        await db.delete(course)
    for u in fakes:
        report.removed.append(f"student {u.email} {u.id}")
        report.old_pages += await photo_store.pages_of_user(db, u.id)
        await db.delete(u)
    await db.flush()
    return school, teacher


# ── Build ────────────────────────────────────────────────────────────


def _extraction(t: TurnIn, pages_of_line: dict[tuple[int, int], int]) -> dict[str, Any]:
    steps: list[dict[str, Any]] = []
    finals: list[dict[str, Any]] = []
    for p_idx, w in enumerate(t.work):
        pos = p_idx + 1
        written = [ln for ln in w.lines if not ln.crossed]
        for n, ln in enumerate(written, start=1):
            steps.append({
                "step_num": n,
                "problem_position": pos,
                "latex": ln.latex,
                "plain_english": to_plain(ln.latex),
                "page_index": pages_of_line[(p_idx, w.lines.index(ln))],
            })
        finals.append({
            "problem_position": pos,
            "answer_latex": w.answer,
            "answer_plain": to_plain(w.answer),
            "page_index": pages_of_line[(p_idx, len(w.lines) - 1)],
        })
    return {"steps": steps, "final_answers": finals, "visual_work": [], "confidence": t.confidence}


def _raw_grades(t: TurnIn) -> list[dict[str, Any]]:
    return [{
        "problem_position": i + 1,
        "student_answer": f"${w.answer}$",
        "reasoning": w.grade.reasoning,
        "score_status": w.grade.status,
        "percent": w.grade.percent,
        "confidence": w.grade.confidence,
        "student_feedback": w.grade.feedback,
        "deductions": [
            {"points_off": off, "reason": reason, "step_ref": ref, "rule_id": None}
            for off, reason, ref in w.grade.deductions
        ],
    } for i, w in enumerate(t.work)]


def _telemetry(turn: Any, at: datetime) -> dict[str, Any]:
    secs = turn.seconds or 0
    typed_ms = 0 if turn.paste else max(1500, int(secs * 1000 * 0.55) - sum(turn.tab_outs_ms))
    blurs = [{"at": (at + timedelta(seconds=3 + i * 9)).isoformat().replace("+00:00", "Z"), "duration_ms": ms}
             for i, ms in enumerate(turn.tab_outs_ms)]
    pastes = ([{"at": (at + timedelta(seconds=max(4, secs - 6))).isoformat().replace("+00:00", "Z"),
                "byte_count": len(turn.text.encode())}] if turn.paste else [])
    return {
        "focus_blur_events": blurs,
        "paste_events": pastes,
        "typing_cadence": None if turn.paste or turn.stuck else {
            "total_ms": typed_ms, "pauses_over_3s": secs // 20, "edits": max(1, len(turn.text) // 25),
        },
        "need_more_time_used": False,
        "device_type": "desktop",
    }


async def _write_check(
    db: AsyncSession, t: TurnIn, sub: Submission, extraction: dict[str, Any],
    bank_ids: list[uuid.UUID], items: dict[uuid.UUID, QuestionBankItem], started: datetime, report: SeedReport,
) -> datetime:
    c = t.check
    correct = {bank_ids[i]: w.grade.status == "full" for i, w in enumerate(t.work)}
    selection = select_probe_problem(items, bank_ids, correct)
    assert selection is not None
    picked = bank_ids.index(selection.bank_item_id) + 1
    assert picked == c.probe_position, (
        f"{t.student} {t.hw}: the app would probe #{picked}, the transcript is about #{c.probe_position}"
    )
    check = IntegrityCheckSubmission(
        submission_id=sub.id, status="complete", disposition=c.disposition,
        overall_summary=c.summary, headline=c.headline[:80],
        probe_selection_reason=selection.selection_reason,
        inline_variant_used=False, inline_variant_result="not_applicable",
        resolution="unresolved", created_at=started,
    )
    db.add(check)
    await db.flush()
    probed = IntegrityCheckProblem(
        integrity_check_submission_id=check.id, bank_item_id=selection.bank_item_id,
        sample_position=0, status="verdict_submitted",
        student_work_extraction=_slice_extraction_for_problem(extraction, c.probe_position),
        rubric=c.rubric, ai_reasoning=c.reasoning, selected_reason=selection.selection_reason,
        created_at=started, updated_at=started,
    )
    db.add(probed)
    for i, w in enumerate(t.work):
        if w.diagnosis is not None:
            kind, note = w.diagnosis
            db.add(IntegrityCheckProblem(
                integrity_check_submission_id=check.id, bank_item_id=bank_ids[i],
                sample_position=i + 1, status="diagnosis_only",
                student_work_extraction=_slice_extraction_for_problem(extraction, i + 1),
                diagnosis_kind=kind, diagnosis_note=note,
                created_at=started + timedelta(seconds=9), updated_at=started + timedelta(seconds=9),
            ))
    await db.flush()

    rows: list[IntegrityConversationTurn] = []
    at = started + timedelta(seconds=6)

    def add(**kw: Any) -> IntegrityConversationTurn:
        row = IntegrityConversationTurn(integrity_check_submission_id=check.id, ordinal=len(rows),
                                        created_at=at, **kw)
        rows.append(row)
        db.add(row)
        return row

    def tool(name: str, payload: dict[str, Any], result: str) -> None:
        nonlocal at
        use_id = f"toolu_{secrets.token_hex(12)}"
        add(role="tool_call", content=json.dumps(payload, ensure_ascii=False), tool_name=name, tool_use_id=use_id)
        add(role="tool_result", content=result, tool_use_id=use_id)
        at += timedelta(seconds=1)

    last = len(c.turns) - 1
    for i, turn in enumerate(c.turns):
        if turn.role == "agent":
            if i == last:
                # The verdict and the close land with the last message.
                tool("submit_problem_verdict",
                     {"problem_id": str(probed.id), "rubric": c.rubric, "reasoning": c.reasoning},
                     f"accepted: rubric recorded (paraphrase={c.rubric['paraphrase_originality']}, "
                     f"causal={c.rubric['causal_fluency']})")
                tool("finish_check",
                     {"disposition": c.disposition, "summary": c.summary, "headline": c.headline,
                      "inline_variant_result": "not_applicable"},
                     f"accepted: disposition {c.disposition}, check complete")
            add(role="agent", content=turn.text)
            at += timedelta(seconds=5)
        else:
            sent = at + timedelta(seconds=turn.seconds or 0)
            add(role="student", content=turn.text, seconds_on_turn=turn.seconds,
                telemetry=_telemetry(turn, at), engagement=turn.engagement).created_at = sent
            at = sent + timedelta(seconds=2)
            tool("label_student_reply", {"engagement": turn.engagement}, "recorded")
    await db.flush()
    check.activity_summary = compute_activity_summary(rows)
    check.updated_at = at
    report.bump("understanding checks")
    report.bump("conversation turns", len(rows))
    return at


async def build(
    db: AsyncSession, school: School, teacher: User, clock: Clock, report: SeedReport,
    *, invite_email: str | None = None,
) -> None:
    t0 = clock.course_created()
    course = Course(school_id=school.id, name=COURSE_NAME, subject="math", grade_level=11,
                    status="active", rubric=None, created_at=t0, updated_at=t0)
    db.add(course)
    await db.flush()
    db.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner", created_at=t0))
    report.course_id = course.id
    units = {}
    for pos, (n, name) in enumerate(UNIT_NAMES.items()):
        units[n] = Unit(course_id=course.id, name=name, position=pos, created_at=t0 + timedelta(minutes=2 + pos))
        db.add(units[n])
    sections = {}
    for i, name in enumerate(SECTION_NAMES):
        sections[name] = Section(course_id=course.id, name=name, join_code=await _generate_unique_join_code(db),
                                 created_at=t0 + timedelta(minutes=5 + i))
        db.add(sections[name])
        await db.flush()
        report.section_ids[name] = sections[name].id
        report.join_codes[name] = sections[name].join_code or ""
    report.bump("units", len(units))
    report.bump("sections", len(sections))

    students = {}
    for i, name in enumerate(STUDENTS):
        joined = t0 + timedelta(days=1, hours=10, minutes=3 * i + (i * 7) % 5)
        u = User(email=FAKE_EMAILS[name], name=name, password_hash=hash_password(secrets.token_urlsafe(32)),
                 grade_level=11, role="student", school_id=school.id, is_active=True,
                 created_at=joined, updated_at=joined)
        db.add(u)
        await db.flush()
        db.add(SectionEnrollment(section_id=sections[SECTION_OF[name]].id, course_id=course.id,
                                 student_id=u.id, enrolled_at=joined))
        students[name] = u
        report.student_ids[name] = u.id
    report.bump("students", len(students))

    if invite_email:
        invite = await _create_or_refresh_invite(db, sections[INVITE_SECTION].id, invite_email, teacher.id)
        report.invite_email, report.invite_token = invite_email, invite.token

    hw_by_key: dict[str, tuple[Assignment, list[uuid.UUID], dict[uuid.UUID, QuestionBankItem]]] = {}
    for hw in HOMEWORKS:
        created = clock.created(hw)
        a = Assignment(
            course_id=course.id, unit_ids=[units[hw.unit].id], teacher_id=teacher.id, title=hw.title,
            description=hw.description, type="homework", status="published", due_at=clock.due(hw),
            late_policy=LATE_POLICY_PENALTY_PER_DAY, integrity_check_enabled=True, ai_grading_enabled=True,
            total_points=100, created_at=created, updated_at=clock.published(hw),
        )
        db.add(a)
        await db.flush()
        bank_ids: list[uuid.UUID] = []
        items: dict[uuid.UUID, QuestionBankItem] = {}
        for j, p in enumerate(hw.problems):
            item = QuestionBankItem(
                course_id=course.id, unit_id=units[hw.unit].id, originating_assignment_id=a.id,
                title=p.title, question=p.question,
                solution_steps=[{"title": s_title, "description": desc} for s_title, desc in p.steps],
                final_answer=p.final_answer, difficulty=p.difficulty, format="frq", status="approved",
                source="generated", created_by_id=teacher.id, locked=True,
                created_at=created + timedelta(minutes=4 + j), updated_at=created + timedelta(minutes=9 + j),
            )
            db.add(item)
            await db.flush()
            bank_ids.append(item.id)
            items[item.id] = item
        a.content = {"problem_ids": [str(b) for b in bank_ids]}
        for s in sections.values():
            db.add(AssignmentSection(assignment_id=a.id, section_id=s.id, published_at=clock.published(hw)))
        hw_by_key[hw.key] = (a, bank_ids, items)
        report.assignment_ids[hw.key] = a.id
        report.bump("homework")
        report.bump("bank problems", len(bank_ids))
    await db.flush()

    # The teacher approves and publishes each homework's grades in one sitting.
    review_order: dict[str, int] = {}
    for n, t in enumerate(TURN_INS):
        hw = next(h for h in HOMEWORKS if h.key == t.hw)
        a, bank_ids, items = hw_by_key[t.hw]
        student = students[t.student]
        section = sections[SECTION_OF[t.student]]
        due = clock.due(hw)
        submitted = due - timedelta(hours=t.hours_before_due) + timedelta(minutes=(n * 17) % 41)

        sub_id = uuid.uuid4()
        written = [WrittenProblem(f"{i + 1})", list(w.lines)) for i, w in enumerate(t.work)]
        jpegs, placed = render_pages(t.student, [t.student, SECTION_OF[t.student], f"HW {hw.key}"], written,
                                     seed=zlib.crc32(f"{t.student}:{t.hw}".encode()))
        files = await photo_store.store_pages(sub_id, [
            {"data": base64.b64encode(j).decode("ascii"), "media_type": "image/jpeg",
             "filename": f"IMG_{4100 + n * 3 + k}.jpg"}
            for k, j in enumerate(jpegs)
        ])
        report.new_pages += files
        extraction = _extraction(t, placed.pages)
        confirmed = submitted + timedelta(minutes=2, seconds=10 + (n * 23) % 50)
        sub = Submission(
            id=sub_id, assignment_id=a.id, student_id=student.id, section_id=section.id, status="submitted",
            files=files, extraction=extraction, extraction_confirmed_at=confirmed,
            submitted_at=submitted, is_late=days_late(submitted, due) > 0,
        )
        db.add(sub)
        await db.flush()
        report.submission_ids[(t.student, t.hw)] = sub.id
        report.bump("turn-ins")
        report.bump("photo pages", len(files))

        # Grade: the grader's own post-processing over the authored calls.
        raw = _raw_grades(t)
        pos_to_bid = {i + 1: str(b) for i, b in enumerate(bank_ids)}
        steps_per_pos = {i + 1: sum(1 for ln in w.lines if not ln.crossed) for i, w in enumerate(t.work)}
        breakdown, ai_score = _build_breakdown(
            raw, pos_to_bid, submission_id=str(sub.id), pos_to_step_count=steps_per_pos,
            rules={}, rule_texts={}, points=assignment_points(a),
        )
        graded = confirmed + timedelta(seconds=40 + (n * 13) % 30)
        grade = SubmissionGrade(
            submission_id=sub.id, ai_score=ai_score,
            ai_breakdown={"grades": raw, "problem_percents": {e["problem_id"]: e["percent"] for e in breakdown}},
            breakdown=breakdown, graded_at=graded, late_penalty_waived=False,
            rubric_snapshot=effective_rubric(course.rubric, a.rubric),
        )
        set_final_score(grade, ai_score, penalty_percent(a.late_policy, days_late(submitted, due)))
        if t.state in ("published", "approved"):
            k = review_order[t.hw] = review_order.get(t.hw, 0) + 1
            sitting = due + timedelta(hours=16, minutes=10) if hw.grades_published \
                else clock.local(0, 14, 20)
            grade.reviewed_by, grade.reviewed_at = teacher.id, sitting + timedelta(minutes=4 * k)
        if t.state == "published":
            grade.grade_published_at = due + timedelta(hours=16, minutes=42)
            grade.published_final_score = grade.final_score
            grade.published_late_penalty = grade.late_penalty
            grade.published_breakdown = breakdown
            grade.published_teacher_notes = None
        db.add(grade)
        report.bump("grades")

        await _write_check(db, t, sub, extraction, bank_ids, items,
                           confirmed + timedelta(seconds=25), report)
        report.lines.append(
            f"  {t.hw:<4} {t.student:<7} {SECTION_OF[t.student]:<9} {grade.final_score:5.1f}"
            f"{' (late −' + format(grade.late_penalty, '.1f') + ')' if grade.late_penalty else '':<14}"
            f" {t.state:<10} check: {t.check.disposition}"
        )
    await db.flush()


async def _assert_scope(db: AsyncSession, report: SeedReport, teacher: User, school: School) -> None:
    """What this run wrote is the demo course and the five fake students,
    nothing else — checked in the open transaction, before any commit."""
    fake_ids = list(report.student_ids.values())
    sub_ids = list(report.submission_ids.values())
    assert len(fake_ids) == len(STUDENTS) and len(sub_ids) == len(TURN_INS)
    students = (await db.execute(select(User).where(User.id.in_(fake_ids)))).scalars().all()
    assert all(u.school_id == school.id and u.email.endswith("@" + FAKE_DOMAIN) and u.role == "student"
               for u in students)
    enrolled = set((await db.execute(
        select(SectionEnrollment.student_id).where(SectionEnrollment.course_id == report.course_id)
    )).scalars())
    assert enrolled == set(fake_ids), "the demo course's roster is not exactly the fake students"
    authors = set((await db.execute(
        select(Submission.student_id).join(Assignment, Assignment.id == Submission.assignment_id)
        .where(Assignment.course_id == report.course_id)
    )).scalars())
    assert authors <= set(fake_ids), "a turn-in in the demo course isn't a fake student's"
    llm = (await db.execute(select(func.count(LLMCall.id)).where(
        or_(LLMCall.submission_id.in_(sub_ids), LLMCall.user_id.in_(fake_ids))
    ))).scalar_one()
    assert llm == 0, "llm_calls rows reference the demo data"
    owner = (await db.execute(
        select(CourseTeacher.teacher_id).where(CourseTeacher.course_id == report.course_id)
    )).scalars().all()
    assert owner == [teacher.id]


async def seed_demo_school(
    db: AsyncSession, *, school_id: uuid.UUID, teacher_email: str,
    invite_email: str | None = None, now: datetime | None = None,
) -> SeedReport:
    """Reset and rebuild the demo class inside the caller's transaction.
    Never commits; the caller commits (then deletes `old_pages`) or rolls
    back (then deletes `new_pages`)."""
    report = SeedReport()
    school, teacher = await _check_and_reset(db, school_id, teacher_email, report)
    try:
        await build(db, school, teacher, Clock.at(now or datetime.now(UTC)), report, invite_email=invite_email)
        await _assert_scope(db, report, teacher, school)
    except BaseException:
        await photo_store.delete_pages(report.new_pages)
        report.new_pages = []
        raise
    return report


def _print(report: SeedReport, committed: bool) -> None:
    print(f"\nSchool: {report.school_name}   Teacher: {report.teacher_name}")
    print("Removed from the earlier run:" if report.removed else "Nothing from an earlier run to remove.")
    for r in report.removed:
        print(f"  - {r}")
    print(f"\nCreated {COURSE_NAME!r} ({report.course_id}):")
    for k, v in report.created.items():
        print(f"  {v:>4} {k}")
    print("\n  hw   student section   score               state      check")
    print("\n".join(report.lines))
    print("  4.4  fake_5  Period 2  — never turned in (missing)")
    print("  5.1  fake_5  Period 2  — not turned in yet (due Friday)")
    code = report.join_codes.get(INVITE_SECTION)
    print(f"\nJoin {INVITE_SECTION} on camera: sign up at {settings.frontend_url}/register as a student "
          f"with class code {code} (any email works).")
    if report.invite_token:
        print(f"Invite link for {report.invite_email} (no email was sent; expires in {INVITE_EXPIRY_DAYS} days):\n"
              f"  {settings.frontend_url}/invite/section?token={report.invite_token}")
    print(f"\nLLM calls made: 0. Emails sent: 0. Photo store: "
          f"{'S3 bucket ' + settings.photo_bucket if settings.photo_bucket else 'local dir'}.")
    print("COMMITTED." if committed else "DRY RUN — rolled back; nothing was saved. Re-run with --commit to keep it.")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--school-id", required=True, type=uuid.UUID)
    parser.add_argument("--teacher-email", required=True)
    parser.add_argument("--invite-email", help="also create a pending Period 2 invite for this address (no email)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True, help="roll back at the end (default)")
    mode.add_argument("--commit", action="store_true", help="commit the reset and the new class")
    args = parser.parse_args()

    from api.database import get_session_factory

    async with get_session_factory()() as db:
        try:
            report = await seed_demo_school(db, school_id=args.school_id, teacher_email=args.teacher_email,
                                            invite_email=args.invite_email)
        except RefusedError as e:
            await db.rollback()
            print(f"REFUSED: {e}\nNothing was changed.", file=sys.stderr)
            return 2
        if args.commit:
            await db.commit()
            await photo_store.delete_pages(report.old_pages)
        else:
            await db.rollback()
            await photo_store.delete_pages(report.new_pages)
    _print(report, args.commit)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
