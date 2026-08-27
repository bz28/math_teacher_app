"""Shared utilities for sending teacher source documents to Claude.

Source documents are the files a teacher uploads to a course (textbook
pages, worksheets, lesson notes) and then selects to ground a generation
run. Claude reads JPEG/PNG as `image` blocks and PDF as native
`document` blocks — `to_content_block` owns that mapping.
"""

import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.image_utils import to_content_block
from api.models.course import Document

logger = logging.getLogger(__name__)

# Everything `validate_and_decode_upload` accepts on the way in. These
# must stay in sync: a format we store but don't forward is a file the
# teacher believes is grounding her problems while the model never sees
# it (PDFs silently fell into that gap and generation fell back to the
# unit name alone).
_SUPPORTED_SOURCE_TYPES = {"image/jpeg", "image/png", "application/pdf"}

# Cap documents per call to avoid token limits
MAX_VISION_IMAGES = 5

# Anthropic caps a single request at 32MB, and base64 inflates bytes by
# ~4/3 — so one max-size upload (MAX_PDF_BYTES, 25MB) is ~33MB on the
# wire and would blow the request on its own. Budget the cumulative
# encoded size and skip whatever doesn't fit, leaving headroom for the
# prompt and tool schema. An oversized selection degrades to "fewer
# documents" (visible in the attachment metadata) rather than an opaque
# API error.
MAX_TOTAL_SOURCE_B64_BYTES = 24 * 1024 * 1024


async def fetch_source_documents(
    db: AsyncSession,
    document_ids: list[uuid.UUID],
    course_id: uuid.UUID,
    *,
    max_images: int | None = None,
) -> list[dict[str, str]]:
    """Fetch teacher source documents from DB for a Claude call.

    Returns list of {"filename", "base64", "media_type"} for JPEG, PNG,
    and PDF docs. Validates all documents belong to the given course.
    If max_images is set, caps the returned list; documents that would
    push the request past MAX_TOTAL_SOURCE_B64_BYTES are skipped.
    """
    if not document_ids:
        return []

    rows = (await db.execute(
        select(Document.id, Document.filename, Document.file_type, Document.image_data)
        .where(Document.id.in_(document_ids), Document.course_id == course_id)
    )).all()

    documents = []
    total_b64_bytes = 0
    for row in rows:
        if row.file_type not in _SUPPORTED_SOURCE_TYPES:
            continue
        if not row.image_data:
            continue
        # Skip rather than break: a small doc listed after an oversized
        # one still reaches the model.
        if total_b64_bytes + len(row.image_data) > MAX_TOTAL_SOURCE_B64_BYTES:
            logger.warning(
                "Skipping source document %s (%s): would exceed the %dMB "
                "request budget",
                row.id, row.filename, MAX_TOTAL_SOURCE_B64_BYTES // 1024 // 1024,
            )
            continue
        total_b64_bytes += len(row.image_data)
        documents.append({
            "filename": row.filename,
            "base64": row.image_data,
            "media_type": row.file_type,
        })
        if max_images and len(documents) >= max_images:
            break

    return documents


def build_attachment_metadata(
    selected_count: int,
    used_images: list[dict[str, str]],
) -> dict[str, Any]:
    """Structured provenance of the source docs fed to a generation call.

    Records the filenames actually sent to the model, how many documents
    the teacher selected (N), and how many survived the media-type filter
    + MAX_VISION_IMAGES cap + size budget and were actually sent (M).
    Logged ONLY as call_metadata on the LLM call — never added to the
    model prompt — so the admin observability can show "using M of N
    attached documents" and warning-flag a run that was silently
    truncated (M < N).

    `used_images` is the post-cap list from `fetch_source_documents`
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
    documents: list[dict[str, str]],
    text_prompt: str,
) -> list[dict[str, Any]]:
    """Build Claude content blocks from source documents + text prompt.

    Returns a list of content blocks: documents first (each labelled with
    its filename), then the text. `to_content_block` maps each payload to
    the block type Claude expects — `image` for JPEG/PNG, `document` for
    PDF, which Claude reads natively as a multi-page document.
    """
    blocks: list[dict[str, Any]] = []

    for doc in documents:
        # Label each document with its filename for context
        blocks.append({"type": "text", "text": f"[Document: {doc['filename']}]"})
        blocks.append(to_content_block(doc["media_type"], doc["base64"]))

    blocks.append({"type": "text", "text": text_prompt})
    return blocks
