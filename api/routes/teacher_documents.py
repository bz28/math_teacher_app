"""Teacher document management — upload, list, delete."""

import base64
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.course import Document
from api.models.unit import Unit
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


class UploadDocumentRequest(BaseModel):
    image_base64: str
    filename: str = "upload.jpg"


@router.post("/courses/{course_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(
    course_id: uuid.UUID, body: UploadDocumentRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)

    # Validate base64 and size
    try:
        raw = base64.b64decode(body.image_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 data")
    if len(raw) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    # Detect file type from filename
    ext = body.filename.rsplit(".", 1)[-1].lower() if "." in body.filename else "jpg"
    type_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "pdf": "application/pdf"}
    file_type = type_map.get(ext, "image/jpeg")

    doc = Document(
        course_id=course_id, teacher_id=current_user.user_id,
        filename=body.filename, file_type=file_type,
        file_size=len(raw), image_data=body.image_base64,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return {"id": str(doc.id), "filename": doc.filename, "file_size": doc.file_size}


@router.get("/courses/{course_id}/documents")
async def list_documents(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    docs = (await db.execute(
        select(Document.id, Document.filename, Document.file_type, Document.file_size, Document.unit_id, Document.created_at)
        .where(Document.course_id == course_id)
        .order_by(Document.created_at.desc())
    )).all()
    return {"documents": [{
        "id": str(d.id), "filename": d.filename,
        "file_type": d.file_type, "file_size": d.file_size,
        "unit_id": str(d.unit_id) if d.unit_id else None,
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
        raise HTTPException(status_code=404, detail="Document not found")
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
        raise HTTPException(status_code=404, detail="Document not found")
    await db.delete(doc)
    await db.commit()
    return {"status": "ok"}


class UpdateDocumentRequest(BaseModel):
    unit_id: uuid.UUID | None = None  # null = move to uncategorized


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
        raise HTTPException(status_code=404, detail="Document not found")

    # Validate unit belongs to same course
    if body.unit_id is not None:
        unit = (await db.execute(
            select(Unit).where(Unit.id == body.unit_id, Unit.course_id == course_id)
        )).scalar_one_or_none()
        if not unit:
            raise HTTPException(status_code=404, detail="Unit not found in this course")

    doc.unit_id = body.unit_id
    await db.commit()
    return {"status": "ok"}
