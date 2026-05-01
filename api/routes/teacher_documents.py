"""Teacher document management — upload, list, delete."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.document_vision import fetch_document_images
from api.core.image_utils import validate_and_decode_upload
from api.core.unit_suggestions import suggest_units
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.course import Document
from api.models.unit import Unit
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()


class UploadDocumentRequest(BaseModel):
    file_base64: str
    filename: str = "upload.jpg"
    unit_id: uuid.UUID


@router.post("/courses/{course_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(
    course_id: uuid.UUID, body: UploadDocumentRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)

    # Magic-byte validation: confirms the bytes are actually JPEG/PNG/PDF
    # and enforces per-format size caps. Filename extension is only a label.
    try:
        raw, file_type = validate_and_decode_upload(body.file_base64)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None

    # Validate unit belongs to same course.
    unit = (await db.execute(
        select(Unit).where(Unit.id == body.unit_id, Unit.course_id == course_id)
    )).scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unit not found in this course")

    doc = Document(
        course_id=course_id, teacher_id=current_user.user_id,
        filename=body.filename, file_type=file_type,
        file_size=len(raw), image_data=body.file_base64,
        unit_id=body.unit_id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return {
        "id": str(doc.id),
        "filename": doc.filename,
        "file_type": doc.file_type,
        "file_size": doc.file_size,
        "unit_id": str(doc.unit_id),
        "created_at": doc.created_at.isoformat(),
    }


@router.get("/courses/{course_id}/documents")
async def list_documents(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    docs = (await db.execute(
        select(
            Document.id, Document.filename, Document.file_type,
            Document.file_size, Document.unit_id, Document.created_at,
        )
        .where(Document.course_id == course_id)
        .order_by(Document.created_at.desc())
    )).all()
    return {"documents": [{
        "id": str(d.id), "filename": d.filename,
        "file_type": d.file_type, "file_size": d.file_size,
        "unit_id": str(d.unit_id),
        "created_at": d.created_at.isoformat(),
    } for d in docs]}


@router.get("/courses/{course_id}/documents/{document_id}")
async def get_document(
    course_id: uuid.UUID, document_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    doc = (await db.execute(
        select(Document).where(Document.id == document_id, Document.course_id == course_id)
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return {
        "id": str(doc.id), "filename": doc.filename,
        "file_type": doc.file_type, "file_size": doc.file_size,
        "image_data": doc.image_data,
        "created_at": doc.created_at.isoformat(),
    }


@router.delete("/courses/{course_id}/documents/{document_id}")
async def delete_document(
    course_id: uuid.UUID, document_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    doc = (await db.execute(
        select(Document).where(Document.id == document_id, Document.course_id == course_id)
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    await db.delete(doc)
    await db.commit()
    return {"status": "ok"}


class UpdateDocumentRequest(BaseModel):
    unit_id: uuid.UUID  # required — every doc lives in a unit


@router.patch("/courses/{course_id}/documents/{document_id}")
async def update_document(
    course_id: uuid.UUID, document_id: uuid.UUID, body: UpdateDocumentRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    doc = (await db.execute(
        select(Document).where(Document.id == document_id, Document.course_id == course_id)
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    unit = (await db.execute(
        select(Unit).where(Unit.id == body.unit_id, Unit.course_id == course_id)
    )).scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unit not found in this course")

    doc.unit_id = body.unit_id
    await db.commit()
    return {"status": "ok"}


class SuggestUnitsRequest(BaseModel):
    filenames: list[str]
    document_ids: list[uuid.UUID] | None = None


@router.post("/courses/{course_id}/suggest-units")
async def suggest_document_units(
    course_id: uuid.UUID,
    body: SuggestUnitsRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    course = await get_teacher_course(db, course_id, current_user.user_id)

    # Get existing unit names
    units = (await db.execute(
        select(Unit.name).where(Unit.course_id == course_id).order_by(Unit.position)
    )).scalars().all()

    # Fetch document images if IDs provided
    images = None
    if body.document_ids:
        images = await fetch_document_images(db, body.document_ids, course_id)

    suggestions = await suggest_units(
        filenames=body.filenames,
        existing_units=list(units),
        course_name=course.name,
        course_subject=course.subject,
        user_id=str(current_user.user_id),
        images=images or None,
    )

    return {"suggestions": suggestions}
