"""Seed a minimal teacher→course→unit→published-assignment world directly
against the (harness) database — mirrors tests/conftest.py's `world` fixture
but trimmed to what a generation run needs (no pre-seeded bank items; the
probe generates those for real). The running API process shares this DB and
JWT secret, so the tokens minted here authenticate against it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission
from api.models.course import Course, CourseTeacher
from api.models.question_bank import FORMAT_MCQ, QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User


@dataclass
class Seed:
    teacher_id: str
    student_id: str
    student_email: str  # for flows that drive the real login form (password "x")
    course_id: str
    unit_id: str
    assignment_id: str
    teacher_token: str
    student_token: str
    teacher_refresh: str
    student_refresh: str
    admin_id: str
    admin_token: str
    admin_refresh: str


async def seed_world() -> Seed:
    async with get_session_factory()() as s:
        # Teachers require a school (ck_users_school_required_for_teacher);
        # mint an individual-kind school like the indie-teacher signup flow.
        school = School(
            name="Harness School", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Harness", contact_email="harness@t.com",
        )
        s.add(school)
        await s.flush()

        teacher = User(
            email=f"harness_teacher_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=12, role="teacher",
            name="Harness Teacher", school_id=school.id,
        )
        student_email = f"harness_student_{uuid.uuid4().hex[:6]}@t.com"
        student = User(
            email=student_email,
            password_hash=hash_password("x"), grade_level=8, role="student",
            name="Harness Student",
        )
        # Platform-level admin (no school) so the improver can scan the admin
        # dashboard surfaces, which sit behind require_admin.
        admin = User(
            email=f"harness_admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=99, role="admin",
            name="Harness Admin",
        )
        s.add_all([teacher, student, admin])
        await s.flush()

        course = Course(name="Geometry Harness", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        # Course ownership is via the CourseTeacher join (get_teacher_course).
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))

        unit = Unit(course_id=course.id, name="Figures", position=0)
        s.add(unit)
        await s.flush()

        section = Section(course_id=course.id, name="Period 1")
        s.add(section)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=student.id,
        ))

        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Geometry HW", type="homework", status="published",
            content={"problems": []},
        )
        s.add(assignment)
        await s.flush()
        s.add(AssignmentSection(
            assignment_id=assignment.id, section_id=section.id,
            published_at=datetime.now(UTC),
        ))
        # Refresh tokens are DB-backed; the web auth guard needs both an
        # access and a refresh token present to consider us logged in.
        teacher_refresh = await create_refresh_token(s, teacher.id)
        student_refresh = await create_refresh_token(s, student.id)
        admin_refresh = await create_refresh_token(s, admin.id)
        await s.commit()

        return Seed(
            teacher_id=str(teacher.id), student_id=str(student.id),
            student_email=student_email,
            course_id=str(course.id), unit_id=str(unit.id),
            assignment_id=str(assignment.id),
            teacher_token=create_access_token(str(teacher.id), "teacher"),
            student_token=create_access_token(str(student.id), "student"),
            teacher_refresh=teacher_refresh, student_refresh=student_refresh,
            admin_id=str(admin.id),
            admin_token=create_access_token(str(admin.id), "admin"),
            admin_refresh=admin_refresh,
        )


@dataclass
class RichSeed(Seed):
    """A `Seed` plus a published PRACTICE assignment whose approved bank
    items give the school student practice + learn surfaces real content
    to render. `practice_assignment_id` is the id the school-student
    practice/learn URLs key off."""

    practice_assignment_id: str = ""


# A self-contained right-triangle SVG so the seeded geometry problem +
# one of its solution steps render a real figure (FigureDisplay embeds
# this string after DOMPurify). Kept tiny + inline so seeding needs no
# geometry renderer / LLM call.
_TRIANGLE_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140" '
    'width="200" height="140" role="img">'
    '<polygon points="30,110 170,110 30,20" fill="none" '
    'stroke="#0f766e" stroke-width="2"/>'
    '<rect x="30" y="92" width="18" height="18" fill="none" '
    'stroke="#0f766e" stroke-width="1.5"/>'
    '<text x="95" y="128" font-size="13" text-anchor="middle" '
    'fill="#334155">b = 14</text>'
    '<text x="14" y="68" font-size="13" text-anchor="middle" '
    'fill="#334155">a = 9</text>'
    '</svg>'
)

# Minimal 3-4 item practice bank. Each item is an approved MCQ with a
# correct final_answer, 3 distractors, and teacher-style solution_steps
# (the shape the LearnPanel reads: {title, description, figure_svg?}).
_PRACTICE_ITEMS: list[dict[str, object]] = [
    {
        "title": "Right-triangle area",
        "question": "A right triangle has legs of length $9$ and $14$. "
                    "What is its area?",
        "final_answer": "63",
        "distractors": ["126", "23", "112"],
        "figure_svg": _TRIANGLE_SVG,
        "solution_steps": [
            {"title": "Recall the formula",
             "description": "The area of a triangle is "
                            "$A = \\tfrac{1}{2}\\,b\\,h$."},
            {"title": "Use the legs as base and height",
             "description": "For a right triangle the two legs are "
                            "perpendicular, so $b = 14$ and $h = 9$.",
             "figure_svg": _TRIANGLE_SVG},
            {"title": "Compute",
             "description": "$A = \\tfrac{1}{2}\\times 14\\times 9 = 63$."},
        ],
    },
    {
        "title": "Solve a linear equation",
        "question": "Solve for $x$: $3x + 5 = 20$.",
        "final_answer": "5",
        "distractors": ["15", "25/3", "-5"],
        "figure_svg": None,
        "solution_steps": [
            {"title": "Isolate the term",
             "description": "Subtract $5$ from both sides: $3x = 15$."},
            {"title": "Divide",
             "description": "Divide both sides by $3$: $x = 5$."},
        ],
    },
    {
        "title": "Pythagorean hypotenuse",
        "question": "A right triangle has legs $6$ and $8$. "
                    "How long is the hypotenuse?",
        "final_answer": "10",
        "distractors": ["14", "48", "\\sqrt{28}"],
        "figure_svg": None,
        "solution_steps": [
            {"title": "Apply the theorem",
             "description": "$c^2 = a^2 + b^2 = 6^2 + 8^2 = 100$."},
            {"title": "Take the root",
             "description": "$c = \\sqrt{100} = 10$."},
        ],
    },
    {
        "title": "Percent of a number",
        "question": "What is $25\\%$ of $80$?",
        "final_answer": "20",
        "distractors": ["25", "55", "320"],
        "figure_svg": None,
        "solution_steps": [
            {"title": "Convert the percent",
             "description": "$25\\% = 0.25$."},
            {"title": "Multiply",
             "description": "$0.25 \\times 80 = 20$."},
        ],
    },
]


async def seed_world_rich() -> RichSeed:
    """`seed_world()` plus a published practice set with real bank items.

    Reuses the base world (school/teacher/student/course/section/HW +
    tokens), then attaches a `type="practice"` assignment published to
    the student's section and 4 approved `QuestionBankItem`s pointed at
    it via `originating_assignment_id` — exactly the shape
    `GET /school/student/practice/{id}` reads. This gives the school
    practice + learn surfaces content to render for screenshots.
    """
    base = await seed_world()
    course_id = uuid.UUID(base.course_id)
    unit_id = uuid.UUID(base.unit_id)
    teacher_id = uuid.UUID(base.teacher_id)
    student_id = uuid.UUID(base.student_id)

    async with get_session_factory()() as s:
        # The base seed leaves the student school-less (an individual
        # learner). The school-student surfaces (/school/student/*) only
        # render when `user.school_id` is set — otherwise app-layout
        # falls back to the individual-learner shell. Link the student to
        # the course's school so the practice/dashboard routes resolve.
        school_id = (await s.execute(
            select(Course.school_id).where(Course.id == course_id)
        )).scalar_one()
        student = (await s.execute(
            select(User).where(User.id == student_id)
        )).scalar_one()
        student.school_id = school_id

        # The student's section in this course — the practice set is
        # published to it so the enrollment gate in practice_detail passes.
        section_id = (await s.execute(
            select(SectionEnrollment.section_id).where(
                SectionEnrollment.student_id == student_id,
                SectionEnrollment.course_id == course_id,
            ).limit(1)
        )).scalar_one()

        practice = Assignment(
            course_id=course_id, unit_ids=[unit_id], teacher_id=teacher_id,
            title="Geometry Practice", type="practice", status="published",
            content={"problems": []},
            # Mark it as cloned from the seeded HW so the "Cloned from …"
            # provenance line renders on the practice detail page.
            source_homework_id=uuid.UUID(base.assignment_id),
        )
        s.add(practice)
        await s.flush()
        s.add(AssignmentSection(
            assignment_id=practice.id, section_id=section_id,
            published_at=datetime.now(UTC),
        ))

        for spec in _PRACTICE_ITEMS:
            s.add(QuestionBankItem(
                course_id=course_id, unit_id=unit_id,
                originating_assignment_id=practice.id,
                title=str(spec["title"]),
                question=str(spec["question"]),
                final_answer=str(spec["final_answer"]),
                distractors=spec["distractors"],
                solution_steps=spec["solution_steps"],
                figure_svg=spec["figure_svg"],
                difficulty="medium",
                format=FORMAT_MCQ,
                status="approved",
                created_by_id=teacher_id,
            ))
        await s.commit()
        practice_id = str(practice.id)

    return RichSeed(
        **{k: getattr(base, k) for k in base.__dataclass_fields__},
        practice_assignment_id=practice_id,
    )


async def seed_joinable_section(seed: Seed) -> str:
    """A section the seeded student is NOT in yet, carrying a live join
    code — the precondition for the join-class flow. It lives in a fresh
    course (not the seeded one) so the student doesn't trip the
    one-enrollment-per-course guard, and is owned by the seeded teacher.
    Returns the join code.
    """
    async with get_session_factory()() as s:
        school_id = (await s.execute(
            select(Course.school_id).where(Course.id == uuid.UUID(seed.course_id))
        )).scalar_one()
        course = Course(name="Joinable Course", subject="math", school_id=school_id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(
            course_id=course.id, teacher_id=uuid.UUID(seed.teacher_id), role="owner",
        ))
        # <=10 chars, uppercase, unique (the column is UNIQUE) — the shape
        # `POST /teacher/join` upper-cases and looks up.
        code = f"J{uuid.uuid4().hex[:7].upper()}"
        s.add(Section(
            course_id=course.id, name="Joinable", join_code=code,
        ))
        await s.commit()
    return code


async def seed_submitted_submission(seed: Seed) -> str:
    """A fresh student enrolled in the seeded section with one SUBMITTED
    submission on the seeded homework — the precondition for the
    grade-and-publish flow. A distinct student (not the seeded one) so it
    never collides with the submit-homework flow on the
    UNIQUE(assignment_id, student_id) constraint. Returns the submission id.
    """
    course_id = uuid.UUID(seed.course_id)
    async with get_session_factory()() as s:
        section_id = (await s.execute(
            select(SectionEnrollment.section_id).where(
                SectionEnrollment.student_id == uuid.UUID(seed.student_id),
                SectionEnrollment.course_id == course_id,
            ).limit(1)
        )).scalar_one()
        student = User(
            email=f"harness_submitter_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=8, role="student",
            name="Harness Submitter",
        )
        s.add(student)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section_id, course_id=course_id, student_id=student.id,
        ))
        submission = Submission(
            assignment_id=uuid.UUID(seed.assignment_id), student_id=student.id,
            section_id=section_id, status="submitted", files=[], is_late=False,
        )
        s.add(submission)
        await s.commit()
        return str(submission.id)
