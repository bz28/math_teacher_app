"""Shared utilities for sending document images to Claude Vision."""

import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.course import Document

logger = logging.getLogger(__name__)

# JPEG/PNG only — PDFs not supported by Claude Vision
_VISION_MEDIA_TYPES = {"image/jpeg", "image/png"}

# Cap images per vision call to avoid token limits
MAX_VISION_IMAGES = 5


async def fetch_document_images(
    db: AsyncSession,
    document_ids: list[uuid.UUID],
    course_id: uuid.UUID,
    *,
    max_images: int | None = None,
) -> list[dict[str, str]]:
    """Fetch document images from DB for vision processing.

    Returns list of {"filename", "base64", "media_type"} for JPEG/PNG docs only.
    Validates all documents belong to the given course.
    If max_images is set, caps the returned list.
    """
    if not document_ids:
        return []

    rows = (await db.execute(
        select(Document.id, Document.filename, Document.file_type, Document.image_data)
        .where(Document.id.in_(document_ids), Document.course_id == course_id)
    )).all()

    images = []
    for row in rows:
        if row.file_type not in _VISION_MEDIA_TYPES:
            continue
        if not row.image_data:
            continue
        images.append({
            "filename": row.filename,
            "base64": row.image_data,
            "media_type": row.file_type,
        })
        if max_images and len(images) >= max_images:
            break

    return images


def build_vision_content(
    images: list[dict[str, str]],
    text_prompt: str,
) -> list[dict[str, Any]]:
    """Build Claude Vision content blocks from images + text prompt.

    Returns a list of content blocks: images first (with filename labels), then text.
    """
    blocks: list[dict[str, Any]] = []

    for img in images:
        # Label each image with its filename for context
        blocks.append({"type": "text", "text": f"[Document: {img['filename']}]"})
        blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": img["media_type"],
                "data": img["base64"],
            },
        })

    blocks.append({"type": "text", "text": text_prompt})
    return blocks
