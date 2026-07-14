"""Shared utilities for sending document images to Claude Vision."""

import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.course import Document

logger = logging.getLogger(__name__)

# Source-document forwarding to the generate flow only sends raster
# images today. PDFs would need a separate code path (Anthropic accepts
# them as `document` blocks, not `image` blocks); not in scope here.
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


def build_attachment_metadata(
    selected_count: int,
    used_images: list[dict[str, str]],
) -> dict[str, Any]:
    """Structured provenance of the source docs fed to a generation call.

    Records the filenames actually sent to the model, how many documents
    the teacher selected (N), and how many survived the media-type filter
    + MAX_VISION_IMAGES cap and were actually sent (M). Logged ONLY as
    call_metadata on the LLM call — never added to the model prompt — so
    the admin observability can show "using M of N attached documents"
    and warning-flag a run the cap silently truncated (M < N).

    `used_images` is the post-cap list from `fetch_document_images`
    (each carries a "filename"); upload-mode pages carry no filename, so
    filenames are collected defensively.
    """
    return {
        "attached_doc_filenames": [
            img["filename"] for img in used_images if img.get("filename")
        ],
        "attached_docs_selected": selected_count,
        "attached_docs_used": len(used_images),
    }


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
