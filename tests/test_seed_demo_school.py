"""scripts/seed_demo_school.py — the demo class it builds, its reset, and
what it must never touch.

The handwriting renderer is stubbed to one tiny page per turn-in (it
takes about a second a turn-in); one test renders a real page."""

from __future__ import annotations

import io
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
from PIL import Image
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.integrity_check import IntegrityCheckProblem, IntegrityCheckSubmission
from api.models.llm_call import LLMCall
from api.models.school import School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from scripts.demo_school_content import TURN_INS
from scripts.demo_school_pages import Placed, WrittenProblem, render_pages
from scripts.seed_demo_school import COURSE_NAME, RefusedError, seed_demo_school

TEACHER = "teacher@demo-school.test"


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 50), "white").save(buf, format="JPEG")
    return buf.getvalue()


def _fake_render(
    hand_of: str, header: list[str], problems: list[WrittenProblem], seed: int,
) -> tuple[list[bytes], Placed]:
    placed = Placed({(p, ln): 1 for p, prob in enumerate(problems) for ln in range(len(prob.lines))})
    return [_jpeg()], placed


@pytest.fixture
async def demo_school() -> AsyncIterator[dict[str, Any]]:
    async with get_session_factory()() as db:
        await db.execute(text("TRUNCATE TABLE schools, users RESTART IDENTITY CASCADE"))
        school = School(name="Demo School", contact_name="T", contact_email=TEACHER)
        other = School(name="Other School", contact_name="O", contact_email="o@other.test")
        db.add_all([school, other])
        await db.flush()
        teacher = User(email=TEACHER, name="Ms. Teacher", password_hash=hash_password("x"), grade_level=12,
                       role="teacher", school_id=school.id)
        db.add(teacher)
        await db.flush()
        preview = User(email="preview+t@veradic.ai", name="Ms. Teacher (Preview)", password_hash=hash_password("x"),
                       grade_level=12, role="student", school_id=school.id, is_preview=True,
                       preview_owner_id=teacher.id)
        real = User(email="real@demo-school.test", name="Real Kid", password_hash=hash_password("x"),
                    grade_level=11, role="student", school_id=school.id)
        db.add_all([preview, real])
        # The teacher's real course, with a real student in it.
        algebra = Course(school_id=school.id, name="Algebra 2", subject="math", status="active")
        db.add(algebra)
        await db.flush()
        db.add(CourseTeacher(course_id=algebra.id, teacher_id=teacher.id, role="owner"))
        sec = Section(course_id=algebra.id, name="Period 1", join_code="ALGB21")
        db.add(sec)
        await db.flush()
        db.add(SectionEnrollment(section_id=sec.id, course_id=algebra.id, student_id=real.id))
        await db.commit()
        yield {"school": school.id, "other": other.id, "teacher": teacher.id, "preview": preview.id,
               "real": real.id, "algebra": algebra.id}


async def _seed(db: AsyncSession, school_id: uuid.UUID, **kw: Any) -> Any:
    with patch("scripts.seed_demo_school.render_pages", _fake_render):
        report = await seed_demo_school(db, school_id=school_id, teacher_email=TEACHER, **kw)
    await db.commit()
    return report


async def _count(db: AsyncSession, model: Any, *where: Any) -> int:
    return int((await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one())


async def test_builds_the_demo_class(demo_school: dict[str, Any]) -> None:
    async with get_session_factory()() as db:
        llm_before = await _count(db, LLMCall)
        report = await _seed(db, demo_school["school"])
        course_id = report.course_id

        assert await _count(db, Section, Section.course_id == course_id) == 2
        hws = (await db.execute(select(Assignment).where(Assignment.course_id == course_id))).scalars().all()
        assert sorted(a.title[:3] for a in hws) == ["4.2", "4.4", "5.1"]
        assert all(a.status == "published" for a in hws)
        assert await _count(db, AssignmentSection, AssignmentSection.assignment_id.in_([a.id for a in hws])) == 6
        students = (await db.execute(select(User).where(User.email.like("fake\\_%")))).scalars().all()
        assert sorted(u.name for u in students) == ["fake_1", "fake_2", "fake_3", "fake_4", "fake_5"]
        assert all(u.school_id == demo_school["school"] and u.email.endswith("@demo-students.invalid")
                   for u in students)

        subs = (await db.execute(
            select(Submission, SubmissionGrade).join(SubmissionGrade).join(Assignment)
            .where(Assignment.course_id == course_id)
        )).all()
        assert len(subs) == len(TURN_INS) == 14
        by = {(s.student_id, s.assignment_id): (s, g) for s, g in subs}
        hw = {a.title[:3]: a for a in hws}
        sid = {u.name: u.id for u in students}

        # 4.2 and 4.4: everything approved and published, snapshot clean.
        for key in ("4.2", "4.4"):
            for name in sid:
                s, g = by[(sid[name], hw[key].id)]
                assert g.grade_published_at and g.reviewed_at and g.published_breakdown == g.breakdown
                assert g.published_final_score == g.final_score
        # 5.1: two waiting on the teacher, one approved not published, one late, fake_5 missing.
        g51 = {name: by.get((sid[name], hw["5.1"].id)) for name in sid}
        assert g51["fake_5"] is None and hw["5.1"].due_at < datetime.now(UTC)
        assert all(g.reviewed_at is None and g.grade_published_at is None for _, g in (g51["fake_1"], g51["fake_2"]))
        assert g51["fake_3"][1].reviewed_at and g51["fake_3"][1].grade_published_at is None
        late_sub, late_grade = g51["fake_4"]
        assert late_sub.is_late and late_grade.late_penalty > 0 and late_grade.grade_published_at is None

        # Understanding checks: one per turn-in, the mix of outcomes, one flag with activity.
        checks = (await db.execute(
            select(IntegrityCheckSubmission).where(IntegrityCheckSubmission.submission_id.in_([s.id for s, _ in subs]))
        )).scalars().all()
        assert len(checks) == 14 and all(c.status == "complete" for c in checks)
        assert {c.disposition for c in checks} == {"pass", "needs_practice", "flag_for_review"}
        flagged = [c for c in checks if c.disposition == "flag_for_review"]
        assert len(flagged) == 1 and flagged[0].activity_summary["totals"]["paste_count"] == 1
        assert flagged[0].activity_summary["notable_turns"]
        # The shared weak spot: three of four 5.1 turn-ins under half on #2.
        p2 = hw["5.1"].content["problem_ids"][1]
        wrong = [n for n in ("fake_1", "fake_2", "fake_3", "fake_4")
                 if next(e for e in g51[n][1].breakdown if e["problem_id"] == p2)["percent"] < 50]
        assert wrong == ["fake_1", "fake_3", "fake_4"]
        assert await _count(db, IntegrityCheckProblem, IntegrityCheckProblem.status == "diagnosis_only") > 0

        assert await _count(db, LLMCall) == llm_before


async def test_rerun_resets_and_leaves_everyone_else_alone(demo_school: dict[str, Any]) -> None:
    async with get_session_factory()() as db:
        first = await _seed(db, demo_school["school"])
        second = await _seed(db, demo_school["school"])
        assert second.removed and first.course_id != second.course_id
        assert await _count(db, Course, Course.id == first.course_id) == 0
        assert await _count(db, User, User.id.in_(list(first.student_ids.values()))) == 0
        assert await _count(db, Course, Course.name == COURSE_NAME) == 1
        assert await _count(db, User, User.email.like("fake\\_%")) == 5
        assert await _count(db, Submission) == 14
        # The teacher, their preview student, the real student and their course are untouched.
        for uid in (demo_school["teacher"], demo_school["preview"], demo_school["real"]):
            assert await _count(db, User, User.id == uid) == 1
        assert await _count(db, SectionEnrollment, SectionEnrollment.course_id == demo_school["algebra"]) == 1


async def test_refuses_when_a_real_student_is_in_the_demo_course(demo_school: dict[str, Any]) -> None:
    async with get_session_factory()() as db:
        report = await _seed(db, demo_school["school"])
        sec = (await db.execute(select(Section).where(Section.course_id == report.course_id))).scalars().first()
        db.add(SectionEnrollment(section_id=sec.id, course_id=report.course_id, student_id=demo_school["real"]))
        await db.commit()
        with pytest.raises(RefusedError):
            await _seed(db, demo_school["school"])
        await db.rollback()
        assert await _count(db, Course, Course.id == report.course_id) == 1


async def test_refuses_a_school_the_teacher_is_not_in(demo_school: dict[str, Any]) -> None:
    async with get_session_factory()() as db:
        with pytest.raises(RefusedError):
            await _seed(db, demo_school["other"])


def test_renders_a_real_photo_page() -> None:
    t = TURN_INS[0]
    pages, placed = render_pages(t.student, ["fake_1"], [WrittenProblem("1)", list(w.lines)) for w in t.work[:2]], 1)
    img = Image.open(io.BytesIO(pages[0]))
    assert img.format == "JPEG" and img.width == 1500
    assert set(placed.pages.values()) == {1}
