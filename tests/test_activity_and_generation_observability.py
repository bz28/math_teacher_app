"""Teacher observability hub: activity instrumentation + generation reads.

Two surfaces:
1. `record_activity` is wired into the key teacher mutations — each writes
   exactly one ActivityLog row with the right action/target, and a forced
   logging failure never breaks the underlying mutation.
2. The admin generation + document-content read routes surface a teacher's
   generation jobs, produced items, correlated LLM cost, and the stored
   source-document image — all admin-only.
"""
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.activity_log import ActivityLog
from api.models.assignment import Assignment
from api.models.course import Course, CourseTeacher, Document
from api.models.llm_call import LLMCall
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.unit import Unit
from api.models.user import User

from .conftest import auth_headers


async def _grant_course_teacher(world: dict[str, uuid.UUID]) -> None:
    """The `world` fixture seeds an Assignment owned by the teacher but no
    CourseTeacher row, so per-item endpoints (which gate on course
    membership via get_teacher_course) 404. Grant it."""
    async with get_session_factory()() as s:
        assignment = (
            await s.execute(
                select(Assignment).where(Assignment.id == world["assignment_id"])
            )
        ).scalar_one()
        s.add(CourseTeacher(
            course_id=assignment.course_id,
            teacher_id=world["teacher_id"],
            role="owner",
        ))
        await s.commit()


async def _activity_rows(action: str) -> list[ActivityLog]:
    async with get_session_factory()() as s:
        return list(
            (
                await s.execute(
                    select(ActivityLog).where(ActivityLog.action == action)
                )
            ).scalars().all()
        )


# ── Instrumentation: each mutation writes one activity row ──


@pytest.mark.asyncio
async def test_reject_writes_one_activity_row(
    client: AsyncClient, world: dict[str, uuid.UUID]
) -> None:
    await _grant_course_teacher(world)
    r = await client.post(
        f"/v1/teacher/question-bank/{world['pending_sibling_id']}/reject",
        headers=auth_headers(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text

    rows = await _activity_rows("bank_item.reject")
    assert len(rows) == 1
    row = rows[0]
    assert row.actor_user_id == world["teacher_id"]
    assert row.actor_role == "teacher"
    assert row.target_type == "bank_item"
    assert row.target_id == world["pending_sibling_id"]


@pytest.mark.asyncio
async def test_approve_writes_one_activity_row(
    client: AsyncClient, world: dict[str, uuid.UUID]
) -> None:
    await _grant_course_teacher(world)
    r = await client.post(
        f"/v1/teacher/question-bank/{world['pending_sibling_id']}/approve",
        headers=auth_headers(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    rows = await _activity_rows("bank_item.approve")
    assert len(rows) == 1
    assert rows[0].target_id == world["pending_sibling_id"]


@pytest.mark.asyncio
async def test_unpublish_writes_one_activity_row(
    client: AsyncClient, world: dict[str, uuid.UUID]
) -> None:
    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/unpublish",
        headers=auth_headers(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    rows = await _activity_rows("assignment.unpublish")
    assert len(rows) == 1
    assert rows[0].target_type == "assignment"
    assert rows[0].target_id == world["assignment_id"]


@pytest.mark.asyncio
async def test_publish_grades_writes_one_activity_row(
    client: AsyncClient, world: dict[str, uuid.UUID]
) -> None:
    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/publish-grades",
        headers=auth_headers(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    rows = await _activity_rows("grade.publish")
    assert len(rows) == 1
    assert rows[0].target_id == world["assignment_id"]


@pytest.mark.asyncio
async def test_logging_failure_never_breaks_the_mutation(
    client: AsyncClient, world: dict[str, uuid.UUID]
) -> None:
    """A forced exception building the activity row must be swallowed —
    the underlying reject still succeeds and no row is written."""
    await _grant_course_teacher(world)
    with patch(
        "api.core.audit_log.ActivityLog", side_effect=RuntimeError("boom")
    ):
        r = await client.post(
            f"/v1/teacher/question-bank/{world['pending_sibling_id']}/reject",
            headers=auth_headers(world["teacher_token"]),
        )
    assert r.status_code == 200, r.text

    async with get_session_factory()() as s:
        item = (
            await s.execute(
                select(QuestionBankItem).where(
                    QuestionBankItem.id == world["pending_sibling_id"]
                )
            )
        ).scalar_one()
        assert item.status == "rejected", "the mutation itself must persist"
    assert await _activity_rows("bank_item.reject") == []


# ── Admin activity endpoint ──


@pytest.mark.asyncio
async def test_activity_endpoint_filters_by_actor(
    client: AsyncClient, world: dict[str, uuid.UUID]
) -> None:
    await _grant_course_teacher(world)
    await client.post(
        f"/v1/teacher/question-bank/{world['pending_sibling_id']}/reject",
        headers=auth_headers(world["teacher_token"]),
    )
    admin = await _make_admin()
    r = await client.get(
        "/v1/admin/activity",
        params={"actor_user_id": str(world["teacher_id"]), "actor_role": "teacher"},
        headers=auth_headers(create_access_token(str(admin), "admin")),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] >= 1
    assert all(e["actor_role"] == "teacher" for e in data["entries"])
    assert any(e["action"] == "bank_item.reject" for e in data["entries"])


@pytest.mark.asyncio
async def test_activity_endpoint_is_admin_only(
    client: AsyncClient, world: dict[str, uuid.UUID]
) -> None:
    r = await client.get(
        "/v1/admin/activity", headers=auth_headers(world["teacher_token"])
    )
    assert r.status_code == 403


# ── Generation observability read routes ──


@pytest.fixture
async def gen_world() -> dict[str, uuid.UUID]:
    """A teacher with one completed generation job: a rendered source
    document, two produced items, and one correlated (paid) LLM call."""
    now = datetime.now(UTC)
    async with get_session_factory()() as s:
        teacher = User(
            email=f"gt_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="GenTeach",
        )
        s.add(teacher)
        await s.flush()

        course = Course(name="Geometry", subject="math")
        s.add(course)
        await s.flush()
        unit = Unit(course_id=course.id, name="Circles", position=0)
        s.add(unit)
        await s.flush()

        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW Circles", type="homework", status="draft",
            content={"problems": []},
        )
        s.add(assignment)
        await s.flush()

        doc = Document(
            course_id=course.id, teacher_id=teacher.id, unit_id=unit.id,
            filename="worksheet.png", file_type="image/png", file_size=68,
            # 1x1 transparent PNG — real base64 the dashboard can render.
            image_data=(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4"
                "2mP8/x8AAusB9YpO3vQAAAAASUVORK5CYII="
            ),
        )
        s.add(doc)
        await s.flush()

        job = QuestionBankGenerationJob(
            course_id=course.id, unit_id=unit.id,
            originating_assignment_id=assignment.id, created_by_id=teacher.id,
            mode="generate", status="done", requested_count=2, produced_count=2,
            constraint="Focus on tangent-line problems",
            source_doc_ids=[str(doc.id)],
            created_at=now, updated_at=now,
        )
        s.add(job)

        for i in range(2):
            s.add(QuestionBankItem(
                course_id=course.id, unit_id=unit.id,
                originating_assignment_id=assignment.id, created_by_id=teacher.id,
                title=f"Q{i + 1}", question=f"Question {i + 1}?",
                solution_steps=[{"title": "Step", "description": "..."}],
                final_answer=f"answer {i + 1}", status="pending",
                source="generated", created_at=now + timedelta(seconds=1),
            ))

        s.add(LLMCall(
            function="generate_questions", model="claude-x",
            input_tokens=100, output_tokens=200, latency_ms=1234.0,
            cost_usd=0.042, user_id=teacher.id, success=True,
            input_text="prompt", output_text="response",
            created_at=now + timedelta(seconds=1),
        ))
        await s.commit()

        return {
            "teacher_id": teacher.id,
            "job_id": job.id,
            "doc_id": doc.id,
        }


async def _make_admin() -> uuid.UUID:
    async with get_session_factory()() as s:
        admin = User(
            email=f"adm_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=0,
            role="admin", name="Admin",
        )
        s.add(admin)
        await s.commit()
        return admin.id


@pytest.mark.asyncio
async def test_generation_jobs_list_correlates_cost(
    client: AsyncClient, gen_world: dict[str, uuid.UUID]
) -> None:
    admin = await _make_admin()
    r = await client.get(
        "/v1/admin/generation/jobs",
        params={"teacher_id": str(gen_world["teacher_id"])},
        headers=auth_headers(create_access_token(str(admin), "admin")),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] == 1
    job = data["jobs"][0]
    assert job["id"] == str(gen_world["job_id"])
    assert job["produced_count"] == 2
    assert job["source_doc_count"] == 1
    assert job["llm_call_count"] == 1
    assert abs(job["llm_cost_usd"] - 0.042) < 1e-6


@pytest.mark.asyncio
async def test_generation_job_detail_returns_items_and_calls(
    client: AsyncClient, gen_world: dict[str, uuid.UUID]
) -> None:
    admin = await _make_admin()
    r = await client.get(
        f"/v1/admin/generation/jobs/{gen_world['job_id']}",
        headers=auth_headers(create_access_token(str(admin), "admin")),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["job"]["constraint"] == "Focus on tangent-line problems"
    assert len(data["items"]) == 2
    assert len(data["llm_calls"]) == 1
    assert data["llm_calls"][0]["input_text"] == "prompt"
    assert len(data["source_documents"]) == 1
    assert data["source_documents"][0]["id"] == str(gen_world["doc_id"])


@pytest.mark.asyncio
async def test_document_content_serves_image(
    client: AsyncClient, gen_world: dict[str, uuid.UUID]
) -> None:
    admin = await _make_admin()
    r = await client.get(
        f"/v1/admin/documents/{gen_world['doc_id']}/content",
        headers=auth_headers(create_access_token(str(admin), "admin")),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["file_type"] == "image/png"
    assert data["image_data"].startswith("iVBOR")


@pytest.mark.asyncio
async def test_generation_routes_are_admin_only(
    client: AsyncClient, gen_world: dict[str, uuid.UUID]
) -> None:
    teacher_token = create_access_token(str(gen_world["teacher_id"]), "teacher")
    for path in (
        "/v1/admin/generation/jobs",
        f"/v1/admin/generation/jobs/{gen_world['job_id']}",
        f"/v1/admin/documents/{gen_world['doc_id']}/content",
    ):
        r = await client.get(path, headers=auth_headers(teacher_token))
        assert r.status_code == 403, f"{path} should be admin-only"
