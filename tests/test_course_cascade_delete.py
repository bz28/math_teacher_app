"""Regression test for DELETE /v1/teacher/courses/{course_id}.

The route previously wrapped the delete in try/except IntegrityError to
catch FK CASCADE failures. That handler was removed in the
teacher_courses wider-lens cleanup PR after a schema-level analysis
concluded the case was unreachable: every FK in the cascade subtree of
courses.id is CASCADE/SET NULL, and the only RESTRICTs (Document.unit_id,
QuestionBankItem.unit_id → units.id) sit on tables that themselves
CASCADE from courses.id, so they're deleted in the same statement.

The PG cascade execution order between the parallel CASCADE paths
(course → docs vs. course → units) is implementation-defined, so this
test pins down the invariant by exercising the worst-case shape:
a course with sections, enrollments, units, documents, QBI items, and a
published assignment, then deleting it through the route. If a future
PG release or schema change ever made the IntegrityError reachable, this
test catches it before users hit a 500.
"""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection
from api.models.course import Course, CourseTeacher, Document
from api.models.question_bank import QuestionBankItem
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from tests.conftest import auth_headers as _auth


async def test_delete_course_cascades_full_subtree(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    # The world fixture seeds a course with a unit, section, enrollment,
    # QBI items, assignment, and assignment_section. Add the missing
    # pieces (CourseTeacher ownership + a Document) to exercise every
    # CASCADE/RESTRICT path off courses.id.
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            select(Assignment.course_id).where(Assignment.id == world["assignment_id"])
        )).scalar_one()

        s.add(CourseTeacher(
            course_id=course_id, teacher_id=world["teacher_id"], role="owner",
        ))
        s.add(Document(
            course_id=course_id,
            teacher_id=world["teacher_id"],
            unit_id=world["unit_id"],
            filename="syllabus.pdf",
            file_type="application/pdf",
            file_size=42,
            image_data="placeholder",
        ))
        await s.commit()

    r = await client.delete(
        f"/v1/teacher/courses/{course_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text

    # Every row that referenced the course must be gone — no IntegrityError
    # along any of the CASCADE/RESTRICT paths.
    async with get_session_factory()() as s:
        assert (await s.execute(
            select(Course).where(Course.id == course_id)
        )).scalar_one_or_none() is None
        assert (await s.execute(
            select(CourseTeacher).where(CourseTeacher.course_id == course_id)
        )).scalar_one_or_none() is None
        assert (await s.execute(
            select(Section).where(Section.course_id == course_id)
        )).scalar_one_or_none() is None
        assert (await s.execute(
            select(SectionEnrollment).where(SectionEnrollment.course_id == course_id)
        )).scalar_one_or_none() is None
        assert (await s.execute(
            select(Unit).where(Unit.course_id == course_id)
        )).scalar_one_or_none() is None
        assert (await s.execute(
            select(Document).where(Document.course_id == course_id)
        )).scalar_one_or_none() is None
        assert (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.course_id == course_id)
        )).scalar_one_or_none() is None
        assert (await s.execute(
            select(Assignment).where(Assignment.course_id == course_id)
        )).scalar_one_or_none() is None
        assert (await s.execute(
            select(AssignmentSection).where(
                AssignmentSection.assignment_id == world["assignment_id"]
            )
        )).scalar_one_or_none() is None
