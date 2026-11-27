"""Seed a believable money world for the Costs page screenshots.

Shaped like prod at the time of writing: one school carries nearly all
spend, the other is small; ~1.4 homeworks per student a month; reading
and grading on Opus 5.5 since a 4 Nov cutover (grading on Sonnet 4.6
before it); the understanding check on Sonnet; a few generated units;
teacher bank chat; a deleted submission's calls; internal admin calls
and a teacher's preview student (both excluded by default). Every
call's cost is priced from its tokens, so the reconciliation reads 0%.

TRUNCATES users, schools and their data — point it at a throwaway DB:
    DATABASE_URL=postgresql+asyncpg://…/<scratch_db> python -m scripts.seed_costs_screens

Login afterwards: admin@veradiclocal.com / admin
"""

import asyncio
import random
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.engine import make_url

from api.config import settings
from api.core.auth import hash_password
from api.core.model_pricing import cost_usd, price_for
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.course import Course
from api.models.llm_call import LLMCall
from api.models.question_bank import QuestionBankGenerationJob
from api.models.school import School
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User

OPUS = "claude-opus-5-5"
SONNET = "claude-sonnet-4-6"
HAIKU = "claude-haiku-4-5"
NOW = datetime.now(UTC)
CUTOVER = datetime(2026, 11, 4, 15, 0, tzinfo=UTC)
WEEKS = 10
rnd = random.Random(1026)


def call(fn: str, model: str, when: datetime, tin: int, tout: int, cread: int = 0,
         **kw: object) -> LLMCall:
    price = price_for(model)
    assert price is not None, model
    return LLMCall(
        function=fn, model=model, input_tokens=tin, output_tokens=tout,
        cache_read_tokens=cread, cache_write_tokens=0,
        latency_ms=float(rnd.randint(800, 9000)),
        cost_usd=cost_usd(price, tin, tout, cread, 0), success=rnd.random() > 0.02,
        created_at=when, **kw,  # type: ignore[arg-type]
    )


def jitter(n: int, spread: float = 0.35) -> int:
    return max(1, int(n * rnd.uniform(1 - spread, 1 + spread)))


async def school(s, name: str, teacher_name: str, students: int) -> dict:  # type: ignore[no-untyped-def]
    sch = School(name=name, contact_name=teacher_name, contact_email=f"{uuid.uuid4().hex[:6]}@school.org")
    s.add(sch)
    await s.flush()
    teacher = User(email=f"t_{uuid.uuid4().hex[:6]}@school.org", password_hash=hash_password("x"),
                   grade_level=99, role="teacher", name=teacher_name, school_id=sch.id)
    kids = [
        User(email=f"s{i}_{uuid.uuid4().hex[:6]}@school.org", password_hash=hash_password("x"),
             grade_level=10, role="student", name=f"{rnd.choice(FIRST)} {rnd.choice(LAST)}",
             school_id=sch.id)
        for i in range(students)
    ]
    s.add_all([teacher, *kids])
    await s.flush()
    course = Course(school_id=sch.id, name="Algebra II", subject="math")
    s.add(course)
    await s.flush()
    section = Section(course_id=course.id, name="Period 2")
    s.add(section)
    await s.flush()
    units = [Unit(course_id=course.id, name=f"Unit {i + 1}", position=i) for i in range(4)]
    s.add_all(units)
    await s.flush()
    return {"school": sch, "teacher": teacher, "kids": kids, "course": course,
            "section": section, "units": units}


FIRST = ["Ava", "Liam", "Maya", "Noah", "Zoe", "Eli", "Iris", "Owen", "Nia", "Theo", "Ruby", "Sam"]
LAST = ["Chen", "Patel", "Okafor", "Garcia", "Kim", "Novak", "Reyes", "Haddad", "Brooks", "Silva"]


async def homework(s, w: dict, week_start: datetime, rate: float) -> None:  # type: ignore[no-untyped-def]
    when0 = week_start + timedelta(days=rnd.randint(0, 4), hours=rnd.randint(13, 21))
    if when0 >= NOW:
        return
    a = Assignment(course_id=w["course"].id, teacher_id=w["teacher"].id,
                   title=f"HW {week_start:%b %d}", type=rnd.choice(["homework"] * 5 + ["quiz"]),
                   unit_ids=[w["units"][0].id], total_points=10)
    s.add(a)
    await s.flush()
    for kid in w["kids"]:
        if rnd.random() > rate:
            continue
        when = when0 + timedelta(hours=rnd.uniform(0, 30))
        if when >= NOW:
            continue
        sub = Submission(assignment_id=a.id, student_id=kid.id, section_id=w["section"].id,
                         status="submitted", submitted_at=when)
        s.add(sub)
        await s.flush()
        common = {"school_id": w["school"].id, "user_id": kid.id, "submission_id": sub.id}
        grader = OPUS if when >= CUTOVER else SONNET
        s.add(call("integrity_extract", OPUS, when, jitter(14000), jitter(2600), jitter(4000), **common))
        s.add(call("ai_grading", grader, when + timedelta(minutes=2), jitter(6000), jitter(1400), **common))
        for t in range(rnd.randint(3, 8)):
            s.add(call("integrity_agent", SONNET, when + timedelta(minutes=5 + t), jitter(2200),
                       jitter(220), jitter(1500), **common))
        if rnd.random() < 0.25:
            s.add(call("drawing_check", OPUS, when + timedelta(minutes=3), jitter(5000), jitter(500), **common))
        # A re-upload: the first submission's read survives with no submission.
        if rnd.random() < 0.03:
            s.add(call("integrity_extract", OPUS, when - timedelta(minutes=10), jitter(14000),
                       jitter(2600), school_id=w["school"].id, user_id=kid.id, submission_id=None))


def _refuse_unless_local() -> None:
    """It TRUNCATEs users and schools: never against anything but a local DB."""
    host = make_url(settings.database_url).host
    if host not in ("localhost", "127.0.0.1", "::1", None):
        raise SystemExit(f"refusing to seed {host!r}: this script wipes the database")


async def main() -> None:
    _refuse_unless_local()
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE teacher_reports, llm_calls, sessions, submission_grades, "
            "submissions, assignments, question_bank_generation_jobs, section_enrollments, "
            "sections, units, course_teachers, courses, teacher_invites, schools, users "
            "RESTART IDENTITY CASCADE"
        ))
        admin = User(email="admin@veradiclocal.com", password_hash=hash_password("admin"),
                     grade_level=99, role="admin", name="Console Admin")
        s.add(admin)
        await s.flush()
        big = await school(s, "Radnor High School", "Dana Whitfield", 64)
        small = await school(s, "Lower Merion Academy", "Marcus Bell", 7)

        start = (NOW - timedelta(days=NOW.weekday(), weeks=WEEKS - 1)).replace(
            hour=0, minute=0, second=0, microsecond=0,
        )
        for wk in range(WEEKS):
            week = start + timedelta(weeks=wk)
            # A school calendar: some weeks heavy, a quiet holiday week.
            n_hw = [1, 2, 1, 2, 1, 1, 2, 0, 1, 1][wk]
            for _ in range(n_hw):
                await homework(s, big, week, rate=0.55)
            if wk % 3 == 0:
                await homework(s, small, week, rate=0.6)

        # Generation: three units built, one with two jobs.
        origin = Assignment(course_id=big["course"].id, teacher_id=big["teacher"].id,
                            title="Draft", type="homework", total_points=10)
        s.add(origin)
        await s.flush()
        for ui, jobs in ((0, 2), (1, 1), (2, 1)):
            for j in range(jobs):
                when = NOW - timedelta(days=rnd.randint(2, 20), hours=j)
                job = QuestionBankGenerationJob(
                    course_id=big["course"].id, unit_id=big["units"][ui].id,
                    originating_assignment_id=origin.id, created_by_id=big["teacher"].id,
                    mode="generate", status="done", requested_count=8, created_at=when,
                )
                s.add(job)
                await s.flush()
                common = {"school_id": big["school"].id, "user_id": big["teacher"].id,
                          "generation_job_id": job.id}
                s.add(call("generate_questions", SONNET, when, jitter(9000), jitter(5000), **common))
                for k in range(8):
                    s.add(call("decompose", SONNET, when + timedelta(seconds=30 + k), jitter(2500),
                               jitter(1200), **common))
                    s.add(call("generate_distractors", HAIKU, when + timedelta(seconds=60 + k),
                               jitter(1200), jitter(300), **common))

        # Teacher-side AI: bank chat through the term.
        for teacher, sch in ((big["teacher"], big["school"]), (small["teacher"], small["school"])):
            for _ in range(10 if teacher is big["teacher"] else 3):
                s.add(call("bank_chat", OPUS, NOW - timedelta(days=rnd.uniform(0, 60)),
                           jitter(7000), jitter(900), school_id=sch.id, user_id=teacher.id))

        # Internal: an admin's calls, stamped with no school.
        for _ in range(12):
            s.add(call("bank_chat", OPUS, NOW - timedelta(days=rnd.uniform(0, 30)), jitter(9000),
                       jitter(1500), user_id=admin.id))

        # A teacher's preview student — real rows, not customer usage.
        preview = User(email=f"p_{uuid.uuid4().hex[:6]}@preview.local", password_hash="x",
                       grade_level=10, role="student", name="Preview (Dana)",
                       school_id=big["school"].id, is_preview=True,
                       preview_owner_id=big["teacher"].id)
        s.add(preview)
        await s.flush()
        for _ in range(6):
            s.add(call("ai_grading", OPUS, NOW - timedelta(days=rnd.uniform(0, 20)), jitter(6000),
                       jitter(1400), school_id=big["school"].id, user_id=preview.id))
        await s.commit()
    print("seeded: admin@veradiclocal.com / admin")


if __name__ == "__main__":
    asyncio.run(main())
