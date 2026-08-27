"""Attached-document observability for AI generation (PR #776 extension).

The generation prompt is built from text only; the teacher's attached
documents go to Claude as Vision images and, until now, left no trace of
WHICH files (or how many) were fed. These tests lock in the observability
metadata added on the generation LLM calls and — critically — prove the
metadata does NOT change the prompt / vision content the model receives.

Covers:
- build_attachment_metadata's shape (filenames + two ints).
- fetch_source_documents truncates the selection at MAX_VISION_IMAGES —
  the exact spot "used M of N" is measured.
- generate_questions forwards call_metadata to the model call AND leaves
  the vision content byte-identical whether or not metadata is logged.
- The full generate worker records selected=K + used=min(K, MAX) + the
  used filenames on the question call's metadata.
"""

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text

from api.core.assignment_generation import generate_questions
from api.core.auth import hash_password
from api.core.document_vision import (
    MAX_VISION_IMAGES,
    build_attachment_metadata,
    build_vision_content,
    fetch_source_documents,
)
from api.core.question_bank_generation import _run_generation
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course, CourseTeacher, Document
from api.models.question_bank import QuestionBankGenerationJob
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.unit import Unit
from api.models.user import User

# ── pure helper ──


def test_build_attachment_metadata_shape() -> None:
    used = [
        {"filename": "a.png", "base64": "x", "media_type": "image/png"},
        {"filename": "b.png", "base64": "y", "media_type": "image/png"},
    ]
    meta = build_attachment_metadata(selected_count=4, used_images=used)
    assert meta == {
        "attached_doc_filenames": ["a.png", "b.png"],
        "attached_docs_selected": 4,
        "attached_docs_used": 2,
    }


def test_build_attachment_metadata_tolerates_missing_filenames() -> None:
    # Upload-mode pages carry {data, media_type} with no filename.
    used = [{"data": "x", "media_type": "image/png"}]
    meta = build_attachment_metadata(selected_count=1, used_images=used)
    assert meta["attached_doc_filenames"] == []
    assert meta["attached_docs_selected"] == 1
    assert meta["attached_docs_used"] == 1


# ── content-invariance: metadata must not touch the model input ──


@pytest.mark.asyncio
async def test_generate_questions_metadata_does_not_change_vision_content() -> None:
    images = [
        {"filename": "p1.png", "base64": "aaa", "media_type": "image/png"},
        {"filename": "p2.png", "base64": "bbb", "media_type": "image/png"},
    ]

    captured: list[dict[str, Any]] = []

    async def fake_vision(content: Any, **kwargs: Any) -> dict[str, Any]:
        captured.append({"content": content, "call_metadata": kwargs.get("call_metadata")})
        return {"questions": [{"title": "Q", "text": "1+1?", "difficulty": "easy"}]}

    meta = build_attachment_metadata(3, images)
    with patch("api.core.assignment_generation.call_claude_vision", side_effect=fake_vision):
        # Same inputs, once WITHOUT metadata, once WITH.
        await generate_questions(
            unit_name="U", count=1, course_name="C", images=images,
            extra_instructions="do the thing", call_metadata=None,
        )
        await generate_questions(
            unit_name="U", count=1, course_name="C", images=images,
            extra_instructions="do the thing", call_metadata=meta,
        )

    assert len(captured) == 2
    # The vision content (system+user text + image blocks) is byte-identical —
    # metadata is a sidecar on the call, never part of the model input.
    assert captured[0]["content"] == captured[1]["content"]
    # And it matches exactly what build_vision_content would produce.
    assert captured[0]["content"] == build_vision_content(
        images, captured[0]["content"][-1]["text"]
    )
    # Metadata is forwarded only when passed.
    assert captured[0]["call_metadata"] is None
    assert captured[1]["call_metadata"] == meta


# ── DB-backed: cap truncation + full worker ──


async def _seed(num_docs: int) -> dict[str, Any]:
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE question_bank_items, question_bank_generation_jobs, "
            "documents, assignments, units, course_teachers, courses, schools, "
            "users RESTART IDENTITY CASCADE"
        ))
        await s.commit()

    async with get_session_factory()() as s:
        school = School(
            name=f"S {tag}", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="C", contact_email=f"c_{tag}@s.com",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"t_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="T", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()
        course = Course(name=f"Alg {tag}", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        s.add(unit)
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW", type="homework", status="draft", content={"problems": []},
        )
        s.add(assignment)
        await s.flush()
        doc_ids: list[uuid.UUID] = []
        for i in range(num_docs):
            d = Document(
                course_id=course.id, teacher_id=teacher.id, unit_id=unit.id,
                filename=f"doc_{i}.png", file_type="image/png", file_size=10,
                image_data="Zm9vYmFy",  # "foobar" base64
            )
            s.add(d)
            await s.flush()
            doc_ids.append(d.id)
        await s.commit()
        return {
            "teacher_id": teacher.id, "course_id": course.id,
            "unit_id": unit.id, "assignment_id": assignment.id,
            "doc_ids": doc_ids,
        }


@pytest.mark.asyncio
async def test_fetch_source_documents_caps_selection_at_max() -> None:
    k = MAX_VISION_IMAGES + 2
    seed = await _seed(k)
    async with get_session_factory()() as s:
        images = await fetch_source_documents(
            s, seed["doc_ids"], seed["course_id"], max_images=MAX_VISION_IMAGES,
        )
    assert len(images) == MAX_VISION_IMAGES  # cap truncated the selection
    meta = build_attachment_metadata(len(seed["doc_ids"]), images)
    assert meta["attached_docs_selected"] == k
    assert meta["attached_docs_used"] == MAX_VISION_IMAGES
    assert len(meta["attached_doc_filenames"]) == MAX_VISION_IMAGES


@pytest.mark.asyncio
async def test_run_generation_records_truncated_attachment_metadata() -> None:
    k = MAX_VISION_IMAGES + 2  # 7 selected, 5 usable
    seed = await _seed(k)

    async with get_session_factory()() as s:
        job = QuestionBankGenerationJob(
            course_id=seed["course_id"], unit_id=seed["unit_id"],
            originating_assignment_id=seed["assignment_id"],
            created_by_id=seed["teacher_id"], status="queued",
            requested_count=1, difficulty="mixed",
            source_doc_ids=[str(d) for d in seed["doc_ids"]],
        )
        s.add(job)
        await s.commit()
        await s.refresh(job)
        job_id = job.id

    captured: dict[str, Any] = {}

    async def fake_vision(content: Any, **kwargs: Any) -> dict[str, Any]:
        captured["content"] = content
        captured["call_metadata"] = kwargs.get("call_metadata")
        return {"questions": [{"title": "Q", "text": "1+1?", "difficulty": "easy"}]}

    with (
        patch("api.core.assignment_generation.call_claude_vision", side_effect=fake_vision),
        patch("api.core.question_bank_generation.generate_solutions",
              AsyncMock(return_value=[{"question_text": "1+1?", "steps": [], "final_answer": "2"}])),
        patch("api.core.question_bank_generation.generate_distractors",
              AsyncMock(return_value=[])),
    ):
        async with get_session_factory()() as s:
            job = (await s.execute(
                select(QuestionBankGenerationJob).where(
                    QuestionBankGenerationJob.id == job_id,
                )
            )).scalar_one()
            await _run_generation(s, job)

    meta = captured["call_metadata"]
    assert meta is not None
    assert meta["attached_docs_selected"] == k
    assert meta["attached_docs_used"] == MAX_VISION_IMAGES
    assert len(meta["attached_doc_filenames"]) == MAX_VISION_IMAGES
    # Every recorded filename is one the teacher actually attached.
    assert all(fn.startswith("doc_") for fn in meta["attached_doc_filenames"])
    # The vision content carried the 5 image blocks + the text prompt — the
    # metadata is nowhere in it.
    image_blocks = [b for b in captured["content"] if b.get("type") == "image"]
    assert len(image_blocks) == MAX_VISION_IMAGES
