"""Integration tests for POST /question-bank/upload.

Covers:
- Mixed image+PDF payload accepted (PR 1 plumbing wired through here).
- Optional `constraint` hint persisted on the job row.
- Constraint shows up in the system prompt sent to Claude (the
  whole point of accepting it — the model needs to see it).
"""

from __future__ import annotations

import base64
from typing import Any
from unittest.mock import patch

from httpx import AsyncClient
from sqlalchemy import text

from api.database import get_session_factory

# Tiny payloads with the right magic bytes — we never decode beyond
# the header for validation, so a ~10-byte body is enough.
_PNG_HEADER = b"\x89PNG\r\n\x1a\n"
_PDF_HEADER = b"%PDF-1.4\n%\xc7\xec\x8f\xa2\n"

TINY_PNG = base64.b64encode(_PNG_HEADER + b"png-payload").decode("ascii")
TINY_PDF = base64.b64encode(_PDF_HEADER + b"pdf-payload").decode("ascii")


async def _link_teacher_to_course(teacher_id: Any, course_id: Any) -> None:
    """The world fixture seeds an Assignment owned by the teacher but
    no CourseTeacher row. Endpoints that gate on course ownership
    require it explicitly."""
    from api.models.course import CourseTeacher
    async with get_session_factory()() as s:
        s.add(CourseTeacher(course_id=course_id, teacher_id=teacher_id, role="owner"))
        await s.commit()


async def _course_id_for(world: dict[str, Any]) -> str:
    async with get_session_factory()() as s:
        return (await s.execute(
            text("SELECT course_id FROM assignments WHERE id=:id"),
            {"id": world["assignment_id"]},
        )).scalar_one()


async def test_upload_accepts_mixed_image_and_pdf(
    client: AsyncClient,
    world: dict[str, Any],
) -> None:
    """Endpoint accepts a list with both JPEG/PNG and PDF in one shot.
    Job row stores both with their detected media types — the
    extraction worker can then send each as the correct content block."""
    course_id = await _course_id_for(world)
    await _link_teacher_to_course(world["teacher_id"], course_id)

    # Don't actually run the worker — we just want to assert what got
    # persisted on submit.
    with patch("api.routes.teacher_question_bank.schedule_generation_job"):
        r = await client.post(
            f"/v1/teacher/courses/{course_id}/question-bank/upload",
            headers={"Authorization": f"Bearer {world['teacher_token']}"},
            json={
                "images": [TINY_PNG, TINY_PDF],
                "assignment_id": str(world["assignment_id"]),
                "unit_id": str(world["unit_id"]),
            },
        )

    assert r.status_code == 202, r.text
    job_id = r.json()["id"]

    async with get_session_factory()() as s:
        job = (await s.execute(
            text(
                'SELECT mode, uploaded_images, "constraint" '
                'FROM question_bank_generation_jobs WHERE id=:id'
            ),
            {"id": job_id},
        )).one()
    assert job.mode == "upload"
    assert job.uploaded_images is not None
    assert len(job.uploaded_images) == 2
    media_types = sorted(f["media_type"] for f in job.uploaded_images)
    assert media_types == ["application/pdf", "image/png"]
    assert job.constraint is None


async def test_upload_persists_optional_constraint(
    client: AsyncClient,
    world: dict[str, Any],
) -> None:
    """When the teacher provides a `constraint` hint ("Q1-13 odd"),
    it lands on the job row so the worker can forward it to the
    extraction prompt."""
    course_id = await _course_id_for(world)
    await _link_teacher_to_course(world["teacher_id"], course_id)

    with patch("api.routes.teacher_question_bank.schedule_generation_job"):
        r = await client.post(
            f"/v1/teacher/courses/{course_id}/question-bank/upload",
            headers={"Authorization": f"Bearer {world['teacher_token']}"},
            json={
                "images": [TINY_PNG],
                "assignment_id": str(world["assignment_id"]),
                "unit_id": str(world["unit_id"]),
                "constraint": "Q1-13 odd",
            },
        )

    assert r.status_code == 202, r.text
    job_id = r.json()["id"]

    async with get_session_factory()() as s:
        constraint = (await s.execute(
            text(
                'SELECT "constraint" FROM question_bank_generation_jobs WHERE id=:id'
            ),
            {"id": job_id},
        )).scalar_one()
    assert constraint == "Q1-13 odd"


async def test_upload_rejects_non_pdf_non_image(
    client: AsyncClient,
    world: dict[str, Any],
) -> None:
    """A blob that isn't JPEG/PNG/PDF should 400 with a per-file
    error message naming which file failed (so the teacher can
    recover instead of staring at "your upload failed")."""
    course_id = await _course_id_for(world)
    await _link_teacher_to_course(world["teacher_id"], course_id)

    bogus = base64.b64encode(b"GIF89a-not-supported").decode("ascii")
    with patch("api.routes.teacher_question_bank.schedule_generation_job"):
        r = await client.post(
            f"/v1/teacher/courses/{course_id}/question-bank/upload",
            headers={"Authorization": f"Bearer {world['teacher_token']}"},
            json={
                "images": [TINY_PNG, bogus],
                "assignment_id": str(world["assignment_id"]),
                "unit_id": str(world["unit_id"]),
            },
        )
    assert r.status_code == 400
    assert "File 2" in r.json()["detail"]


async def test_extract_from_files_includes_constraint_in_prompt() -> None:
    """`_extract_from_files` appends the constraint clause to the
    system prompt when set, and leaves the prompt untouched when
    null/empty. This is the contract the upload flow leans on."""
    from unittest.mock import AsyncMock

    from api.core.question_bank_generation import _extract_from_files

    captured: dict[str, Any] = {}

    async def fake_vision(content: list[Any], mode: str, **_: Any) -> dict[str, object]:
        captured["text"] = content[-1]["text"]
        return {"questions": []}

    files = [{"data": TINY_PNG, "media_type": "image/png"}]

    # With constraint — clause appears in the trailing text block.
    with patch(
        "api.core.question_bank_generation.call_claude_vision",
        new=AsyncMock(side_effect=fake_vision),
    ):
        await _extract_from_files(
            files, subject="math", user_id="u1", constraint="Q1-13 odd"
        )
    assert "Q1-13 odd" in captured["text"]
    assert "skip everything else" in captured["text"]

    # Without constraint — clause is absent.
    captured.clear()
    with patch(
        "api.core.question_bank_generation.call_claude_vision",
        new=AsyncMock(side_effect=fake_vision),
    ):
        await _extract_from_files(
            files, subject="math", user_id="u1", constraint=None
        )
    assert "Q1-13 odd" not in captured["text"]
    assert "skip everything else" not in captured["text"]

    # Whitespace-only is treated as no constraint.
    captured.clear()
    with patch(
        "api.core.question_bank_generation.call_claude_vision",
        new=AsyncMock(side_effect=fake_vision),
    ):
        await _extract_from_files(
            files, subject="math", user_id="u1", constraint="   "
        )
    assert "skip everything else" not in captured["text"]
