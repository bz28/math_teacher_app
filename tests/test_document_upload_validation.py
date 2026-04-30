"""POST /v1/teacher/courses/{id}/documents — magic-byte validation.

Confirms the upload endpoint:
- Accepts JPEG / PNG / PDF when the bytes' magic match
- Rejects bytes that don't match any of the three (400)
- Rejects invalid base64 (400)
- Returns the full document shape (id, filename, file_type, file_size,
  unit_id, created_at) so the frontend can append to its in-memory list
  without a refetch
"""
import base64
import uuid

import pytest
from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.course import Course, CourseTeacher
from api.models.unit import Unit
from api.models.user import User

from .conftest import auth_headers

# Tiny 1×1 transparent PNG (valid magic bytes 89 50 4E 47 0D 0A 1A 0A).
TINY_PNG_BYTES = base64.b64decode(
    b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YpO3vQAAAAASUVORK5CYII="
)
TINY_PNG_B64 = base64.b64encode(TINY_PNG_BYTES).decode()

# Minimal JPEG header (FF D8 FF) followed by some bytes — magic bytes
# are what the validator checks; full validity isn't required.
TINY_JPEG_BYTES = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
TINY_JPEG_B64 = base64.b64encode(TINY_JPEG_BYTES).decode()

# Minimal PDF header — %PDF- signature is enough for the magic-byte check.
TINY_PDF_BYTES = (
    b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n"
    b"xref\n0 1\n0000000000 65535 f\ntrailer<<>>\n%%EOF"
)
TINY_PDF_B64 = base64.b64encode(TINY_PDF_BYTES).decode()


@pytest.fixture
async def teacher_with_unit() -> dict[str, str]:
    """A teacher who owns a course with one unit, ready for doc uploads."""
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        teacher = User(
            email=f"upload_teacher_{tag}@t.com",
            password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="UT",
        )
        s.add(teacher)
        await s.flush()

        course = Course(name=f"Algebra {tag}", subject="math")
        s.add(course)
        await s.flush()

        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))

        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        s.add(unit)
        await s.commit()
        await s.refresh(unit)

        return {
            "token": create_access_token(str(teacher.id), "teacher"),
            "course_id": str(course.id),
            "unit_id": str(unit.id),
        }


async def test_upload_accepts_png(
    client: AsyncClient, teacher_with_unit: dict[str, str],
) -> None:
    headers = auth_headers(teacher_with_unit["token"])
    r = await client.post(
        f"/v1/teacher/courses/{teacher_with_unit['course_id']}/documents",
        headers=headers,
        json={
            "file_base64": TINY_PNG_B64,
            "filename": "diagram.png",
            "unit_id": teacher_with_unit["unit_id"],
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    # Fattened response includes all fields, not just {id, filename, file_size}
    assert body["file_type"] == "image/png"
    assert body["unit_id"] == teacher_with_unit["unit_id"]
    assert "created_at" in body
    assert body["filename"] == "diagram.png"
    assert body["file_size"] == len(TINY_PNG_BYTES)


async def test_upload_accepts_jpeg(
    client: AsyncClient, teacher_with_unit: dict[str, str],
) -> None:
    headers = auth_headers(teacher_with_unit["token"])
    r = await client.post(
        f"/v1/teacher/courses/{teacher_with_unit['course_id']}/documents",
        headers=headers,
        json={
            "file_base64": TINY_JPEG_B64,
            "filename": "photo.jpg",
            "unit_id": teacher_with_unit["unit_id"],
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["file_type"] == "image/jpeg"


async def test_upload_accepts_pdf(
    client: AsyncClient, teacher_with_unit: dict[str, str],
) -> None:
    headers = auth_headers(teacher_with_unit["token"])
    r = await client.post(
        f"/v1/teacher/courses/{teacher_with_unit['course_id']}/documents",
        headers=headers,
        json={
            "file_base64": TINY_PDF_B64,
            "filename": "worksheet.pdf",
            "unit_id": teacher_with_unit["unit_id"],
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["file_type"] == "application/pdf"


async def test_upload_rejects_unsupported_format(
    client: AsyncClient, teacher_with_unit: dict[str, str],
) -> None:
    """Bytes that don't match any of JPEG / PNG / PDF magic bytes get 400.
    Previously the route would silently store these as image/jpeg via the
    extension fallback."""
    headers = auth_headers(teacher_with_unit["token"])
    junk_b64 = base64.b64encode(b"hello world this is not a recognized format").decode()
    r = await client.post(
        f"/v1/teacher/courses/{teacher_with_unit['course_id']}/documents",
        headers=headers,
        json={
            "file_base64": junk_b64,
            "filename": "report.docx",
            "unit_id": teacher_with_unit["unit_id"],
        },
    )
    assert r.status_code == 400, r.text
    assert "Unsupported file format" in r.json()["detail"]


async def test_upload_rejects_invalid_base64(
    client: AsyncClient, teacher_with_unit: dict[str, str],
) -> None:
    headers = auth_headers(teacher_with_unit["token"])
    r = await client.post(
        f"/v1/teacher/courses/{teacher_with_unit['course_id']}/documents",
        headers=headers,
        json={
            "file_base64": "@@@not valid base64@@@",
            "filename": "photo.png",
            "unit_id": teacher_with_unit["unit_id"],
        },
    )
    assert r.status_code == 400, r.text
    assert "Invalid base64" in r.json()["detail"]


async def test_upload_filename_doesnt_determine_type(
    client: AsyncClient, teacher_with_unit: dict[str, str],
) -> None:
    """Uploading PNG bytes under a misleading filename should still be
    accepted — the magic bytes win, the filename is just a label."""
    headers = auth_headers(teacher_with_unit["token"])
    r = await client.post(
        f"/v1/teacher/courses/{teacher_with_unit['course_id']}/documents",
        headers=headers,
        json={
            "file_base64": TINY_PNG_B64,
            "filename": "totally_a_pdf.pdf",
            "unit_id": teacher_with_unit["unit_id"],
        },
    )
    assert r.status_code == 201, r.text
    # Magic bytes won — type reflects what the bytes actually are.
    assert r.json()["file_type"] == "image/png"
