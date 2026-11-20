"""Seed the walkthrough world.

Builds on ``scripts.seed_design_audit_world.seed()`` (Ms. Rivera, three
courses, ~28 students, homework in every state) and adds what the video
needs on top:

* ``tours_seen = ["teacher"]`` so the old spotlight tour never mounts.
* Readable emails (``ava.alvarez@lincoln.k12.us``) and fixed join codes,
  so every rerun renders the same screens. The previous run's world is
  "retired" first (emails and codes renamed out of the way) — the
  walkthrough DB is dedicated, so nothing else is affected.
* One submission in Algebra I · Period 1 · "Slope & Intercepts" whose
  understanding check finished as ``flag_for_review`` with a short
  transcript, so the understanding-check chapter has something real to
  open.
* A draft homework ("Systems of Equations") with worked solutions, so
  the editor chapter can show solutions, Preview as student and the
  Publish bar on something that isn't live yet.
* One student (Zoe) whose AI grade has a low-confidence call, so the
  grading chapter has a real judgment to make.

No LLM calls. Everything is written straight to the DB.
"""

from __future__ import annotations

import base64
import re
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update

from api.config import settings
from api.core import photo_store
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.question_bank import QuestionBankItem
from api.models.course import Course, CourseTeacher
from api.models.integrity_check import (
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)
from api.models.section import Section
from api.models.user import User
from scripts.seed_design_audit_world import seed as seed_dense_school

FLAG_HEADLINE = "Correct work, but couldn't explain the slope"
FLAG_SUMMARY = (
    "The written answers were right, but when asked how the slope came out "
    "of the two points, the explanation didn't match the work on the page. "
    "Worth a quick conversation."
)

# (role, content, seconds_on_turn)
TRANSCRIPT = [
    ("agent",
     "Hi! Nice work on the slope problems. On problem 3 you found the slope "
     "through $(2, 5)$ and $(6, 13)$. Can you walk me through how you got it?", None),
    ("student", "i just knew it was 2", 51),
    ("agent",
     "That's the right slope. What did you do with the two points to get "
     "there?", None),
    ("student", "divide them i think", 37),
    ("agent",
     "Let's try one together. If a line goes through $(1, 4)$ and $(3, 10)$, "
     "what would you do first?", None),
    ("student", "not sure", 12),
]


EMAIL_DOMAIN = "lincoln.k12.us"
TEACHER_EMAIL = f"rivera@{EMAIL_DOMAIN}"
# One per section, in creation order (Algebra I P1/P3, Algebra II P4,
# Geometry P6/P7). Charset matches api/routes/teacher_sections.py.
SPARE_NAMES = [
    "Grace Kim", "Leo Martin", "Aria Shah", "Felix Ortiz", "June Patel",
    "Max Rivera", "Ivy Nguyen", "Ezra Cole",
]
MISSING_STUDENTS = ["Lucas Hayes", "Iris Ibrahim"]
JOIN_CODES = ["K7M2QX", "R4TW9P", "H8CZ3N", "D5VJ6F", "W2PL8B"]


async def _retire_previous_world() -> None:
    """Free the fixed emails/join codes a previous run claimed."""
    async with get_session_factory()() as s:
        old = (await s.execute(
            select(User).where(User.email.like(f"%@{EMAIL_DOMAIN}"))
        )).scalars().all()
        # The dense seeder's own emails carry a "_<suffix>"; ours don't.
        for u in (u for u in old if "_" not in u.email):
            u.email = f"retired-{u.id}@walkthrough.invalid"
        await s.execute(
            update(Section).where(Section.join_code.in_(JOIN_CODES)).values(join_code=None)
        )
        await s.commit()


GRADING_STUDENT = "Zoe Ellis"
# (answer, status, percent, confidence, reasoning, feedback, work steps)
ZOE_GRADES = [
    ("x = 8", "full", 100, 0.97, "Correct: subtracted 7, then divided by 2.",
     "Clean two-step solve.", ["2x = 16", "x = 8"]),
    ("x = 7", "full", 100, 0.96, "Correct: distributed, collected terms, solved.",
     "Nice work distributing first.", ["5x - 15 = 2x + 6", "3x = 21", "x = 7"]),
    ("m = 2", "full", 100, 0.95, "Correct: rise over run, 8 / 4.",
     "Right: change in y over change in x.", ["m = (13 - 5)/(6 - 2)", "m = 8/4 = 2"]),
    ("(x - 4)(x - 5)", "full", 100, 0.95, "Correct factors; they multiply back to the original.",
     "Good check by expanding.", ["-4 + -5 = -9, (-4)(-5) = 20", "(x - 4)(x - 5)"]),
    ("(5, 2)", "zero", 0, 0.55,
     "The work finds x = 2 and y = 5 correctly, but the final answer is "
     "written as (5, 2), with the coordinates swapped. It may be a copying "
     "slip or a real mix-up about ordered pairs.",
     "You found x and y correctly. Watch the order: a point is (x, y), so "
     "this one is (2, 5).",
     ["2x + 1 = -x + 7", "3x = 6, x = 2", "y = 2(2) + 1 = 5", "(5, 2)"]),
    ("12x^{10}", "zero", 0, 0.93,
     "Multiplied the exponents (2 x 5 = 10) instead of adding them (2 + 5 = 7).",
     "When you multiply powers of x, add the exponents: x^2 times x^5 is x^7.",
     ["12x^{2 \\cdot 5}", "12x^{10}"]),
]


def _zoe_page() -> dict[str, str]:
    lines = ["5)  2x + 1 = -x + 7", "     3x = 6,  x = 2", "     y = 2(2) + 1 = 5",
             "     (5, 2)", "6)  (3x²)(4x⁵) = 12x¹⁰"]
    rows = "".join(
        f"<text x='34' y='{70 + i * 52}' font-size='26' font-family='Georgia,serif' "
        f"fill='#243b6b' xml:space='preserve'>{line}</text>"
        for i, line in enumerate(lines)
    )
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' width='440' height='330'>"
        "<rect width='440' height='330' fill='#fffdf7'/>"
        + "".join(f"<line x1='0' y1='{y}' x2='440' y2='{y}' stroke='#e6e0d2'/>"
                  for y in range(44, 330, 52))
        + rows + "</svg>"
    )
    return {"data": base64.b64encode(svg.encode()).decode(), "media_type": "image/svg+xml"}


async def _stage_grading_student(s, hw, section, problem_ids) -> None:
    """One student whose AI grade has a genuinely uncertain call (swapped
    coordinates) so she lands in "Needs your eyes" for the grading chapter."""
    sub, grade = (await s.execute(
        select(Submission, SubmissionGrade)
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .join(User, User.id == Submission.student_id)
        .where(Submission.assignment_id == hw.id, Submission.section_id == section.id,
               User.name == GRADING_STUDENT)
    )).one()
    steps, finals, breakdown, ai = [], [], [], []
    for pos, (pid, (ans, status, pct, conf, why, fb, work)) in enumerate(
        zip(problem_ids, ZOE_GRADES, strict=True), start=1,
    ):
        steps += [{"problem_position": pos, "step_num": i + 1, "latex": w, "plain_english": ""}
                  for i, w in enumerate(work)]
        finals.append({"problem_position": pos, "answer_latex": ans, "answer_plain": ans})
        breakdown.append({"problem_id": str(pid), "score_status": status, "percent": float(pct),
                          "confidence": conf, "feedback": fb, "deductions": None,
                          "student_answer": ans})
        ai.append({"problem_position": pos, "student_answer": ans, "score_status": status,
                   "percent": pct, "confidence": conf, "reasoning": why, "feedback": fb,
                   "student_feedback": fb})
    sub.extraction = {"steps": steps, "final_answers": finals, "confidence": 0.93}
    sub.files = await photo_store.store_pages(sub.id, [_zoe_page()])
    score = round(sum(b["percent"] for b in breakdown) / len(breakdown), 1)
    grade.breakdown = breakdown
    grade.ai_breakdown = {"grades": ai, "summary": (
        "Methods are solid across the set. One answer has its coordinates "
        "swapped, and one exponent rule slipped."
    )}
    grade.ai_score = grade.final_score = score


async def _fix_unbraced_exponents(s, school_id) -> None:
    """The dense seeder's wrong answer "12x^10" renders as 12x¹0 in KaTeX;
    the real reader writes 12x^{10}."""
    subs = (await s.execute(
        select(Submission).join(User, User.id == Submission.student_id)
        .where(User.school_id == school_id)
    )).scalars().all()
    for sub in subs:
        if sub.extraction and "12x^10" in str(sub.extraction):
            sub.extraction = _swap(sub.extraction)
        g = await s.scalar(select(SubmissionGrade).where(SubmissionGrade.submission_id == sub.id))
        if g is not None and g.ai_breakdown and "12x^10" in str(g.ai_breakdown):
            g.ai_breakdown = _swap(g.ai_breakdown)


def _swap(obj):
    if isinstance(obj, str):
        return obj.replace("12x^10", "12x^{10}")
    if isinstance(obj, list):
        return [_swap(o) for o in obj]
    if isinstance(obj, dict):
        return {k: _swap(v) for k, v in obj.items()}
    return obj


DRAFT_TITLE = "Systems of Equations"
DRAFT_PROBLEMS = [
    ("Solve the system: $y = 3x - 2$, $y = x + 4$", "$(3, 7)$", "easy", [
        ("Set the two expressions equal", "$3x - 2 = x + 4$"),
        ("Solve for $x$", "$2x = 6$, so $x = 3$"),
        ("Substitute back", "$y = 3 + 4 = 7$"),
    ]),
    ("Solve by elimination: $2x + y = 9$, $x - y = 3$", "$(4, 1)$", "medium", [
        ("Add the equations", "$3x = 12$, so $x = 4$"),
        ("Substitute back", "$4 - y = 3$, so $y = 1$"),
    ]),
    ("Tickets cost \\$5 for students and \\$8 for adults. 40 tickets sold for "
     "\\$254. How many student tickets were sold?", "$22$", "hard", [
        ("Write the system", "$s + a = 40$, $5s + 8a = 254$"),
        ("Substitute $a = 40 - s$", "$5s + 320 - 8s = 254$"),
        ("Solve", "$-3s = -66$, so $s = 22$"),
    ]),
    ("Does the system $y = 2x + 1$, $y = 2x - 3$ have a solution? Explain.",
     "No solution: the lines are parallel", "medium", [
        ("Compare slopes", "Both slopes are $2$"),
        ("Compare intercepts", "The intercepts differ ($1$ and $-3$), so the lines never meet"),
    ]),
]


async def _draft_homework(s, course, published_hw, section, teacher, now) -> uuid.UUID:
    """A ready-to-publish draft with worked solutions for the editor beat."""
    hw = Assignment(
        course_id=course.id, unit_ids=list(published_hw.unit_ids), teacher_id=teacher.id,
        title=DRAFT_TITLE, type="homework", status="draft", late_policy="none",
        due_at=(now + timedelta(days=6)).replace(hour=23, minute=30, second=0, microsecond=0),
    )
    s.add(hw)
    await s.flush()
    s.add(AssignmentSection(assignment_id=hw.id, section_id=section.id, published_at=None))
    items = []
    for i, (q, ans, diff, steps) in enumerate(DRAFT_PROBLEMS):
        it = QuestionBankItem(
            course_id=course.id, unit_id=published_hw.unit_ids[0],
            originating_assignment_id=hw.id, title=f"Problem {i + 1}", question=q,
            final_answer=ans, difficulty=diff, format="frq", status="approved",
            solution_steps=[{"title": t, "description": d} for t, d in steps],
        )
        s.add(it)
        items.append(it)
    await s.flush()
    hw.content = {"problem_ids": [str(it.id) for it in items]}
    return hw.id


def assert_local_world() -> None:
    """Refuse to seed anything but a local database with local photo storage.

    Retiring the previous world nulls the fixed join codes and renames
    matching emails across the whole database, so this must never run
    against a shared, staging or production DB, or upload to the real
    photo bucket.
    """
    db = settings.database_url
    if not re.search(r"@(localhost|127\.0\.0\.1)(:\d+)?/", db):
        host = db.split("@")[-1].split("/")[0] if db else "unset"  # never echo credentials
        raise SystemExit(f"refusing to run: DATABASE_URL must point at localhost (host: {host})")
    if settings.photo_bucket:
        raise SystemExit("refusing to run: unset PHOTO_BUCKET so photos stay on local disk")


async def seed() -> dict:
    assert_local_world()
    await _retire_previous_world()
    ids = await seed_dense_school()
    now = datetime.now(UTC)

    async with get_session_factory()() as s:
        course = await s.get(Course, uuid.UUID(ids["course_id"]))
        teacher_id = (await s.execute(
            select(CourseTeacher.teacher_id).where(CourseTeacher.course_id == course.id)
        )).scalar_one()
        teacher = await s.get(User, teacher_id)
        teacher.tours_seen = ["teacher", "student", "personal"]
        teacher.email = TEACHER_EMAIL

        # Readable student emails + fixed join codes for every section.
        courses = (await s.execute(
            select(Course).join(CourseTeacher, CourseTeacher.course_id == Course.id)
            .where(CourseTeacher.teacher_id == teacher.id)
        )).scalars().all()
        sections = (await s.execute(
            select(Section).where(Section.course_id.in_([c.id for c in courses]))
            .order_by(Section.created_at, Section.name)
        )).scalars().all()
        for sec, code in zip(sections, JOIN_CODES, strict=False):
            sec.join_code = code
        students = (await s.execute(
            select(User).where(User.school_id == teacher.school_id, User.role == "student")
        )).scalars().all()
        # Creation order: the dense seeder emails them "s<n>_<suffix>@…"
        # (created_at is the same transaction timestamp for all of them).
        students = sorted(students, key=lambda u: int(u.email[1:].split("_")[0]))
        # The dense seeder's name list wraps after 28, so the last section
        # repeats the first names; give those students their own.
        spare = iter(SPARE_NAMES)
        seen: set[str] = set()
        for u in students:
            if u.name in seen:
                u.name = next(spare)
            seen.add(u.name)
            u.email = f"{u.name.lower().replace(' ', '.')}@{EMAIL_DOMAIN}"

        hw = await s.get(Assignment, uuid.UUID(ids["graded_hw_id"]))
        section = await s.get(Section, uuid.UUID(ids["section_id"]))
        problem_ids = [uuid.UUID(p) for p in hw.content["problem_ids"]]

        # Pick the highest scorer in the graded section: "correct work but
        # couldn't explain it" is the case the check exists for.
        rows = (await s.execute(
            select(Submission, SubmissionGrade, User)
            .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
            .join(User, User.id == Submission.student_id)
            .where(Submission.assignment_id == hw.id, Submission.section_id == section.id)
            .order_by(SubmissionGrade.ai_score.desc(), User.name)
        )).all()
        sub, _grade, flagged_student = rows[0]


        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == sub.id)
        )).scalar_one()
        check.disposition = "flag_for_review"
        check.headline = FLAG_HEADLINE
        check.overall_summary = FLAG_SUMMARY
        check.resolution = "unresolved"
        check.probe_selection_reason = "verified_hardest_correct"
        s.add(IntegrityCheckProblem(
            integrity_check_submission_id=check.id, bank_item_id=problem_ids[2],
            sample_position=0, status="verdict_submitted",
            selected_reason="verified_hardest_correct",
            rubric={"paraphrase_originality": "low", "causal_fluency": "low",
                    "transfer": "low", "prediction": "not_probed",
                    "authority_resistance": "not_probed",
                    "self_correction": "not_observed"},
            ai_reasoning=(
                "Restated the answer without describing the rise-over-run "
                "step, and couldn't start a similar two-point problem."
            ),
        ))
        for ordinal, (role, content, secs) in enumerate(TRANSCRIPT):
            s.add(IntegrityConversationTurn(
                integrity_check_submission_id=check.id, ordinal=ordinal,
                role=role, content=content, seconds_on_turn=secs,
                created_at=now - timedelta(hours=20) + timedelta(minutes=ordinal),
            ))
        await _stage_grading_student(s, hw, section, problem_ids)
        draft_id = await _draft_homework(s, course, hw, section, teacher, now)
        await _fix_unbraced_exponents(s, teacher.school_id)

        # Two students never turned in last week's homework, so the
        # gradebook's "Missing work" filter has something to show.
        factoring = (await s.execute(
            select(Assignment).where(
                Assignment.course_id == course.id, Assignment.title == "Factoring Practice",
            )
        )).scalars().first()
        missing_ids = (await s.execute(
            select(User.id).where(User.name.in_(MISSING_STUDENTS), User.school_id == teacher.school_id)
        )).scalars().all()
        await s.execute(delete(Submission).where(
            Submission.assignment_id == factoring.id, Submission.student_id.in_(missing_ids),
        ))
        await s.commit()

        ids.update({
            "teacher_id": str(teacher.id),
            "draft_hw_id": str(draft_id),
            "flagged_student_id": str(flagged_student.id),
            "flagged_student_name": flagged_student.name,
        })
    return ids


if __name__ == "__main__":
    import asyncio
    import json

    print(json.dumps(asyncio.run(seed()), indent=2))
