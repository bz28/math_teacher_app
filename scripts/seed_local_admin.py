"""Fill a local database with fake data so the admin console has something to show.

Most admin tabs render an empty state against a fresh dev DB, which makes them
impossible to look at or test. This seeds every operator surface at once:

    .venv/bin/python -m scripts.seed_local_admin

Idempotent — everything it writes is tagged (school/lead names carry a marker,
users live on @seed.example.com), and a re-run deletes the previous batch first.
Safe to run repeatedly; refuses to touch a non-local database.

What it covers, and the surface each row lights up:
  schools + users + activity   -> Schools, Users, Overview
  submissions + grades         -> Grading quality (teacher overrides of AI)
  llm_calls with real payloads -> LLM calls (prompts sized like production)
  contact_leads                -> Leads
  student_record_access_log    -> Audit log

The grade rows matter most: `ai_breakdown` is the AI's immutable snapshot and
`breakdown` is the teacher's edited copy, aligned positionally. A row only
counts as an override when a teacher genuinely reviewed it — see
api/services/grading_overrides.py.
"""

from __future__ import annotations

import asyncio
import random
import sys
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.core.auth import hash_password
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.contact_lead import ContactLead
from api.models.course import Course
from api.models.llm_call import LLMCall
from api.models.school import School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.session import Session as TutorSession
from api.models.student_record_access_log import StudentRecordAccessLog
from api.models.user import User

DB_URL = "postgresql+asyncpg://mathapp:mathapp@localhost:5432/mathapp"
MARK = "[seed]"  # tags rows we own, so a re-run can clear them
DOMAIN = "seed.example.com"
PASSWORD = "LocalDev123!"

rng = random.Random(20260716)
now = datetime.now(UTC)


def ago(**kw) -> datetime:
    return now - timedelta(**kw)


# ── the AI-vs-teacher grade pairs ────────────────────────────────────────────
# Each tuple is (ai_status, ai_percent, teacher_status, teacher_percent).
# A problem is an override when the status flips or percent moves >1.0, so this
# mix yields agreements, harsh calls the teacher raised, and generous ones they
# cut — enough for Grading quality to show a real bias signal instead of 0%.
GRADE_SHAPES = [
    [("full", 100, "full", 100), ("partial", 50, "full", 100), ("zero", 0, "partial", 60)],
    [("full", 100, "partial", 70), ("full", 100, "full", 100), ("partial", 40, "partial", 40)],
    [("partial", 60, "full", 100), ("zero", 0, "zero", 0), ("full", 100, "full", 100)],
    [("full", 100, "full", 100), ("full", 100, "full", 100), ("partial", 80, "full", 100)],
    [("zero", 0, "partial", 50), ("partial", 55, "partial", 90), ("full", 100, "zero", 0)],
]

SUBJECTS = ["Algebra I", "Geometry", "Algebra II", "Pre-Calculus"]


# A prompt shaped like the real thing: production grading calls run ~1400
# tokens. The old fixtures stored ~200 chars while claiming 1400 tokens, which
# hid the fact that the detail pane only showed a sliver of a real prompt.
def big_prompt(subject: str, problem: str) -> str:
    rubric = "\n".join(
        f"  {i}. {c}"
        for i, c in enumerate(
            [
                "Correct final answer, exact form where the problem demands it.",
                "Each algebraic step follows from the previous one.",
                "No sign errors carried forward into later lines.",
                "Work is shown, not just the answer asserted.",
                "Units and notation match the problem statement.",
                "Partial credit where the method is right but arithmetic slips.",
            ]
            * 6
        )
    )
    return (
        f"You are grading a {subject} submission. Grade ONLY what the student wrote.\n\n"
        f"PROBLEM\n{problem}\n\nRUBRIC\n{rubric}\n\n"
        "STUDENT WORK (transcribed from the photo)\n"
        "  Step 1: 2x + 6 = 18\n  Step 2: 2x = 12\n  Step 3: x = 6\n\n"
        "Return JSON: {correct: bool, score: number, feedback: string}. "
        "Do not reveal the answer in feedback; nudge instead."
    )


async def wipe(s: AsyncSession) -> None:
    """Delete the previous seed batch. Order respects FKs."""
    users = (await s.execute(select(User.id).where(User.email.like(f"%@{DOMAIN}")))).scalars().all()
    schools = (await s.execute(select(School.id).where(School.name.like(f"%{MARK}%")))).scalars().all()
    if users:
        subs = (await s.execute(select(Submission.id).where(Submission.student_id.in_(users)))).scalars().all()
        if subs:
            await s.execute(delete(SubmissionGrade).where(SubmissionGrade.submission_id.in_(subs)))
            await s.execute(delete(Submission).where(Submission.id.in_(subs)))
        await s.execute(delete(SectionEnrollment).where(SectionEnrollment.student_id.in_(users)))
        await s.execute(delete(StudentRecordAccessLog).where(StudentRecordAccessLog.target_student_id.in_(users)))
        await s.execute(delete(LLMCall).where(LLMCall.user_id.in_(users)))
        await s.execute(delete(TutorSession).where(TutorSession.user_id.in_(users)))
        await s.execute(delete(Assignment).where(Assignment.teacher_id.in_(users)))
    if schools:
        courses = (await s.execute(select(Course.id).where(Course.school_id.in_(schools)))).scalars().all()
        if courses:
            await s.execute(delete(Section).where(Section.course_id.in_(courses)))
            await s.execute(delete(Course).where(Course.id.in_(courses)))
    if users:
        await s.execute(delete(User).where(User.id.in_(users)))
    if schools:
        await s.execute(delete(School).where(School.id.in_(schools)))
    await s.execute(delete(ContactLead).where(ContactLead.school_name.like(f"%{MARK}%")))
    await s.commit()


async def seed(s: AsyncSession) -> dict[str, int]:
    pw = hash_password(PASSWORD)
    counts: dict[str, int] = {}

    # ── Schools, deliberately in different health states so Schools/Overview
    # have something to sort and flag, not five identical green rows.
    schools = []
    for name, days_quiet in [
        (f"Northgate High {MARK}", 0),
        (f"El Camino Middle {MARK}", 2),
        (f"Brookfield Academy {MARK}", 21),  # at-risk: quiet 14d+
        (f"Summit Charter {MARK}", 45),  # dormant
    ]:
        sc = School(
            id=uuid.uuid4(),
            name=name,
            contact_name="Dana Ortiz",
            contact_email=f"ops+{uuid.uuid4().hex[:6]}@{DOMAIN}",
            created_at=ago(days=90),
        )
        schools.append((sc, days_quiet))
        s.add(sc)
    await s.flush()
    counts["schools"] = len(schools)

    teachers, students = [], []
    for sc, quiet in schools:
        t = User(
            id=uuid.uuid4(),
            email=f"teacher.{uuid.uuid4().hex[:6]}@{DOMAIN}",
            name=rng.choice(["Maya Chen", "Andre Silva", "Priya Nair", "Tom Becker"]),
            password_hash=pw,
            grade_level=9,
            role="teacher",
            is_active=True,
            school_id=sc.id,
            subscription_tier="school",
            subscription_status="active",
            created_at=ago(days=88),
        )
        teachers.append((t, sc, quiet))
        s.add(t)
        for i in range(7):
            st = User(
                id=uuid.uuid4(),
                email=f"student.{uuid.uuid4().hex[:6]}@{DOMAIN}",
                name=rng.choice(
                    [
                        "Ava Miller",
                        "Leo Park",
                        "Ruby Alvarez",
                        "Noah Kim",
                        "Zoe Hart",
                        "Ian Doyle",
                        "Mia Okafor",
                        "Ezra Lin",
                    ]
                ),
                password_hash=pw,
                grade_level=rng.choice([8, 9, 10, 11]),
                role="student",
                is_active=True,
                school_id=sc.id,
                subscription_tier="school",
                subscription_status="active",
                created_at=ago(days=80),
            )
            students.append((st, sc, quiet))
            s.add(st)
    await s.flush()
    counts["users"] = len(teachers) + len(students)

    # ── Courses / sections / assignments — the spine submissions hang off.
    grades_made = subs_made = calls_made = access_made = 0
    for t, sc, quiet in teachers:
        subject = rng.choice(SUBJECTS)
        course = Course(
            id=uuid.uuid4(),
            name=f"{subject} {MARK}",
            school_id=sc.id,
            subject="math",
            status="active",
            created_at=ago(days=85),
        )
        s.add(course)
        await s.flush()
        section = Section(id=uuid.uuid4(), course_id=course.id, name="Period 3", created_at=ago(days=85))
        s.add(section)
        await s.flush()

        cohort = [st for st, csc, _ in students if csc.id == sc.id]
        for st in cohort:
            s.add(
                SectionEnrollment(
                    id=uuid.uuid4(),
                    section_id=section.id,
                    course_id=course.id,
                    student_id=st.id,
                    enrolled_at=ago(days=84),
                )
            )

        for a_i in range(3):
            problem = rng.choice(
                [
                    "Solve for x:  2x + 6 = 18",
                    "Factor completely:  x^2 - 5x + 6",
                    "Find the slope of the line through (2,3) and (6,11).",
                ]
            )
            asg = Assignment(
                id=uuid.uuid4(),
                course_id=course.id,
                teacher_id=t.id,
                title=f"{subject} Set {a_i + 1} {MARK}",
                type="homework",
                created_at=ago(days=24 - a_i * 6),
            )
            s.add(asg)
            await s.flush()

            for st in cohort:
                # A dormant school stays quiet — that's what makes it at-risk.
                if quiet > 14 and rng.random() < 0.8:
                    continue
                submitted = ago(days=rng.randint(1, 12), hours=rng.randint(0, 20))
                sub = Submission(
                    id=uuid.uuid4(),
                    assignment_id=asg.id,
                    student_id=st.id,
                    section_id=section.id,
                    status="graded",
                    submitted_at=submitted,
                )
                s.add(sub)
                await s.flush()
                subs_made += 1

                shape = rng.choice(GRADE_SHAPES)
                ai_grades, teacher_breakdown = [], []
                for pos, (ai_st, ai_pc, te_st, te_pc) in enumerate(shape):
                    ai_grades.append(
                        {"problem_position": pos, "score_status": ai_st, "percent": ai_pc, "feedback": "AI feedback"}
                    )
                    teacher_breakdown.append(
                        {
                            "problem_id": str(uuid.uuid4()),
                            "score_status": te_st,
                            "percent": te_pc,
                            "feedback": "Teacher feedback",
                        }
                    )
                ai_score = sum(g["percent"] for g in ai_grades) / len(ai_grades)
                final = sum(b["percent"] for b in teacher_breakdown) / len(teacher_breakdown)

                # Eligible for the report only when a teacher reviewed or
                # published it. Leave a couple as untouched AI drafts so the
                # "awaiting review" path exists too.
                reviewed = rng.random() > 0.2
                s.add(
                    SubmissionGrade(
                        id=uuid.uuid4(),
                        submission_id=sub.id,
                        ai_score=ai_score,
                        ai_breakdown={"grades": ai_grades},
                        teacher_score=final if reviewed else None,
                        breakdown=teacher_breakdown,
                        final_score=final if reviewed else ai_score,
                        graded_at=submitted + timedelta(minutes=3),
                        reviewed_by=t.id if reviewed else None,
                        reviewed_at=submitted + timedelta(hours=6) if reviewed else None,
                        grade_published_at=submitted + timedelta(hours=7) if reviewed and rng.random() > 0.4 else None,
                    )
                )
                grades_made += 1

                # One tutor session per submission — llm_calls.session_id is a
                # real FK, and session grouping is a feature the console links to.
                sess = TutorSession(
                    id=uuid.uuid4(),
                    user_id=st.id,
                    problem=problem,
                    problem_type="text",
                    status="completed",
                    mode="homework",
                    subject="math",
                    section_id=section.id,
                    created_at=submitted,
                )
                s.add(sess)
                await s.flush()

                # LLM calls carrying production-sized payloads.
                for fn, model in [
                    ("extract_vision", "claude-sonnet-4-6"),
                    ("grade_submission", "claude-sonnet-4-6"),
                    ("tutor_step", "claude-haiku-4-5"),
                ]:
                    failed = rng.random() < 0.07
                    prompt = big_prompt(subject, problem)
                    s.add(
                        LLMCall(
                            id=uuid.uuid4(),
                            function=fn,
                            model=model,
                            input_tokens=len(prompt) // 4,
                            output_tokens=rng.randint(120, 900),
                            latency_ms=rng.uniform(600, 6500),
                            cost_usd=round(rng.uniform(0.004, 0.05), 4),
                            success=not failed,
                            retry_count=2 if failed else 0,
                            input_text=prompt,
                            output_text=(
                                "APIError: overloaded_error (529) after 2 retries"
                                if failed
                                else '{"correct": true, "score": 92, "feedback": '
                                '"Nice work isolating x. Watch the sign on line 2."}'
                            ),
                            user_id=st.id,
                            school_id=sc.id,
                            submission_id=sub.id,
                            session_id=sess.id,
                            call_metadata={"source": "seed"},
                            created_at=submitted + timedelta(minutes=rng.randint(1, 9)),
                        )
                    )
                    calls_made += 1

                # FERPA access trail — the Audit log's whole subject.
                s.add(
                    StudentRecordAccessLog(
                        id=uuid.uuid4(),
                        accessor_user_id=t.id,
                        accessor_role="teacher",
                        target_student_id=st.id,
                        record_type=rng.choice(["submission", "grade", "integrity_check"]),
                        record_id=sub.id,
                        school_id=sc.id,
                        ip_address=f"10.0.{rng.randint(0, 9)}.{rng.randint(2, 250)}",
                        accessed_at=submitted + timedelta(hours=8),
                    )
                )
                access_made += 1

    counts |= {"submissions": subs_made, "grades": grades_made, "llm_calls": calls_made, "access_log": access_made}

    # ── Leads across the pipeline, so Leads isn't a one-row table.
    for i, (name, status) in enumerate(
        [
            ("Riverside Unified", "new"),
            ("Oak Valley District", "contacted"),
            ("Pinecrest Schools", "engaged"),
            ("Harbor Prep", "new"),
            ("Lakeside Collegiate", "contacted"),
        ]
    ):
        s.add(
            ContactLead(
                id=uuid.uuid4(),
                school_name=f"{name} {MARK}",
                contact_name=rng.choice(["Sam Reyes", "Jo Tran", "Casey Wu"]),
                contact_email=f"lead{i}@{DOMAIN}",
                status=status,
                source=rng.choice(["inbound_form", "warm_intro", "outbound", "event"]),
                created_at=ago(days=rng.randint(2, 40)),
            )
        )
    counts["leads"] = 5

    await s.commit()
    return counts


async def main() -> None:
    if "localhost" not in DB_URL and "127.0.0.1" not in DB_URL:
        sys.exit("refusing to seed a non-local database")
    eng = create_async_engine(DB_URL)
    session_factory = async_sessionmaker(eng, expire_on_commit=False)
    async with session_factory() as s:
        await wipe(s)
        counts = await seed(s)
    await eng.dispose()
    width = max(len(k) for k in counts)
    for k, v in counts.items():
        print(f"  {k:<{width}}  {v}")
    print(f"\nsign in: any @{DOMAIN} user / {PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main())
