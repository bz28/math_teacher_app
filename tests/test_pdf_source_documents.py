"""PDF source documents reach Claude (regression guard).

A teacher uploads lesson files to a course and selects them to ground a
generation run. PDFs were accepted on upload and stored, but the fetch
that hands documents to the model filtered to JPEG/PNG only — so every
selected PDF was silently dropped, `images` came back empty, and
generation fell back to the topic-name-only prompt. A teacher whose unit
was named "Trig/Precalculus" got trig problems while her uploaded
lessons on domain/range/difference quotient never reached the model.

These tests lock in that PDFs survive the fetch and leave as native
`document` blocks (not `image` blocks, which the API would reject for
application/pdf), and that the request-size budget degrades to fewer
documents instead of raising.
"""

import uuid
from typing import Any

import pytest
from sqlalchemy import text

from api.core import document_vision as dv
from api.core.auth import hash_password
from api.core.document_vision import build_vision_content, fetch_source_documents
from api.database import get_session_factory
from api.models.course import Course, CourseTeacher, Document
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.unit import Unit
from api.models.user import User

# ── pure: block-type mapping ──


def test_build_vision_content_emits_document_block_for_pdf() -> None:
    """PDF must go as a `document` block — the API rejects a PDF payload
    sent as `image`, which is why the old image-only filter existed."""
    blocks = build_vision_content(
        [{"filename": "lesson.pdf", "base64": "JVBERi0x", "media_type": "application/pdf"}],
        "PROMPT",
    )
    # [label, document, prompt]
    assert [b["type"] for b in blocks] == ["text", "document", "text"]
    assert blocks[1]["source"] == {
        "type": "base64", "media_type": "application/pdf", "data": "JVBERi0x",
    }
    assert blocks[0]["text"] == "[Document: lesson.pdf]"
    assert blocks[-1]["text"] == "PROMPT"


def test_build_vision_content_keeps_images_as_image_blocks() -> None:
    blocks = build_vision_content(
        [
            {"filename": "a.png", "base64": "iVBOR", "media_type": "image/png"},
            {"filename": "b.jpg", "base64": "/9j/4", "media_type": "image/jpeg"},
        ],
        "PROMPT",
    )
    assert [b["type"] for b in blocks] == [
        "text", "image", "text", "image", "text",
    ]


def test_build_vision_content_mixes_pdf_and_image() -> None:
    blocks = build_vision_content(
        [
            {"filename": "notes.pdf", "base64": "JVBERi0x", "media_type": "application/pdf"},
            {"filename": "a.png", "base64": "iVBOR", "media_type": "image/png"},
        ],
        "PROMPT",
    )
    assert [b["type"] for b in blocks] == [
        "text", "document", "text", "image", "text",
    ]


# ── DB-backed: the fetch filter ──


async def _seed(docs: list[tuple[str, str, str]]) -> dict[str, Any]:
    """Seed a course with `docs` as (filename, file_type, image_data)."""
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
        course = Course(name=f"Precalc {tag}", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Trig/Precalculus", position=0)
        s.add(unit)
        await s.flush()
        doc_ids: list[uuid.UUID] = []
        for filename, file_type, data in docs:
            d = Document(
                course_id=course.id, teacher_id=teacher.id, unit_id=unit.id,
                filename=filename, file_type=file_type,
                file_size=len(data), image_data=data,
            )
            s.add(d)
            await s.flush()
            doc_ids.append(d.id)
        await s.commit()
        return {"course_id": course.id, "doc_ids": doc_ids}


@pytest.mark.asyncio
async def test_fetch_source_documents_includes_pdfs() -> None:
    """The regression: a selected PDF must come back from the fetch.

    Before the fix this returned only the PNG, so a teacher who uploaded
    only PDFs got an empty list and a topic-name-only generation.
    """
    seed = await _seed([
        ("lesson.pdf", "application/pdf", "JVBERi0x"),
        ("page.png", "image/png", "iVBOR"),
    ])
    async with get_session_factory()() as s:
        docs = await fetch_source_documents(s, seed["doc_ids"], seed["course_id"])

    by_name = {d["filename"]: d for d in docs}
    assert set(by_name) == {"lesson.pdf", "page.png"}
    assert by_name["lesson.pdf"]["media_type"] == "application/pdf"


@pytest.mark.asyncio
async def test_fetch_source_documents_pdf_only_selection_is_not_empty() -> None:
    """A PDF-only selection — exactly the teacher's case — must survive."""
    seed = await _seed([("unit1.pdf", "application/pdf", "JVBERi0x")])
    async with get_session_factory()() as s:
        docs = await fetch_source_documents(s, seed["doc_ids"], seed["course_id"])
    assert len(docs) == 1
    assert docs[0]["media_type"] == "application/pdf"


@pytest.mark.asyncio
async def test_fetch_source_documents_excludes_unsupported_types() -> None:
    """Widening to PDF must not open the filter to everything — an
    unsupported type would raise in to_content_block downstream."""
    seed = await _seed([
        ("notes.txt", "text/plain", "aGVsbG8="),
        ("ok.pdf", "application/pdf", "JVBERi0x"),
    ])
    async with get_session_factory()() as s:
        docs = await fetch_source_documents(s, seed["doc_ids"], seed["course_id"])
    assert [d["filename"] for d in docs] == ["ok.pdf"]


@pytest.mark.asyncio
async def test_fetch_source_documents_skips_over_budget_doc(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An oversized doc is skipped, not raised on. Base64 inflates a
    25MB PDF to ~33MB — past Anthropic's 32MB request cap — so the
    budget must degrade the run rather than fail it."""
    seed = await _seed([("huge.pdf", "application/pdf", "J" * 64)])
    monkeypatch.setattr(dv, "MAX_TOTAL_SOURCE_B64_BYTES", 16)
    async with get_session_factory()() as s:
        docs = await fetch_source_documents(s, seed["doc_ids"], seed["course_id"])
    assert docs == []


@pytest.mark.asyncio
async def test_fetch_source_documents_budget_admits_what_fits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The budget is cumulative: it admits documents until the next one
    would overflow, rather than dropping the whole selection."""
    seed = await _seed([
        ("a.pdf", "application/pdf", "J" * 10),
        ("b.pdf", "application/pdf", "J" * 10),
        ("c.pdf", "application/pdf", "J" * 10),
    ])
    monkeypatch.setattr(dv, "MAX_TOTAL_SOURCE_B64_BYTES", 25)
    async with get_session_factory()() as s:
        docs = await fetch_source_documents(s, seed["doc_ids"], seed["course_id"])
    # Two fit (20 <= 25); the third would reach 30 and is skipped.
    assert len(docs) == 2
