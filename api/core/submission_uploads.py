"""Validate a homework turn-in's pages before anything is stored.

Shared by submit, the reopened resubmit and retake
(api/routes/school_student_practice.py), so every turn-in is held to
exactly the same rules.
"""

from __future__ import annotations

import asyncio
import base64

from fastapi import HTTPException

from api.core.constants import MAX_PDF_BYTES, MAX_SUBMISSION_TOTAL_BYTES
from api.core.image_utils import (
    MIN_PAGE_LONG_EDGE,
    image_long_edge,
    pdf_scan_long_edges,
    rotate_upload,
    validate_and_decode_upload,
)


async def validated_upload_files(
    files: list[str], rotations: list[int] | None,
) -> list[dict[str, str]]:
    """Validate, size-check and turn each page of a turn-in, returning
    the files as stored. Shared by submit and retake, so a retake is
    held to exactly the rules the first turn-in was. 400 on an
    unreadable or too-small page, 413 over the whole-submission cap."""
    # The work is required and is the source of truth — what the
    # teacher reviews and what the integrity checker reads for per-
    # problem answer extraction. Each file is validated by magic bytes
    # against per-format size caps; we also enforce a whole-submission
    # cap so a 10-PDF payload can't blow up the row store.
    validated_files: list[dict[str, str]] = []
    total_bytes = 0
    pdf_bytes = 0
    for i, raw in enumerate(files):
        # Strip an optional `data:<media>;base64,` prefix before
        # validation. The prefix is informational; magic bytes inside
        # the decoded payload are the source of truth.
        b64 = raw.split(",", 1)[1] if raw.startswith("data:") else raw
        try:
            decoded, media_type = validate_and_decode_upload(b64)
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail=f"File {i + 1}: {e}",
            ) from e
        if media_type == "application/pdf":
            # A PDF page is held to the same floor as a photo: a phone
            # photo saved as a PDF reads no better than the photo. A PDF
            # that can't be opened is left for the reader, as before.
            edges = await asyncio.to_thread(pdf_scan_long_edges, b64)
            small = next(
                ((p, e) for p, e in enumerate(edges, 1) if e is not None and e < MIN_PAGE_LONG_EDGE),
                None,
            )
            if small is not None:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"File {i + 1}, page {small[0]} is too small to read ({small[1]}px). "
                        "Take it again closer up, so the page fills the screen."
                    ),
                )
        else:
            try:
                long_edge = image_long_edge(decoded)
            except Exception as e:
                raise HTTPException(
                    status_code=400, detail=f"File {i + 1}: couldn't read this image",
                ) from e
            if long_edge < MIN_PAGE_LONG_EDGE:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"File {i + 1} is too small to read ({long_edge}px). "
                        "Take it again closer up, so the page fills the screen."
                    ),
                )
        rotation = rotations[i] if rotations else 0
        if rotation:
            try:
                # CPU work — off the event loop.
                b64 = await asyncio.to_thread(rotate_upload, b64, media_type, rotation)
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"File {i + 1}: couldn't read this file to rotate it",
                ) from e
            # Count what is stored, not what was sent.
            stored = len(base64.b64decode(b64))
        else:
            stored = len(decoded)
        total_bytes += stored
        if media_type == "application/pdf":
            pdf_bytes += stored
        validated_files.append({"data": b64, "media_type": media_type})
    if total_bytes > MAX_SUBMISSION_TOTAL_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Submission too large: {total_bytes / 1024 / 1024:.1f}MB "
                f"(max {MAX_SUBMISSION_TOTAL_BYTES // 1024 // 1024}MB total)"
            ),
        )
    # The reader sends a PDF it can't render page by page (unreadable, or
    # past its page cap) whole, and every page of a turn-in goes in one
    # model request. So the PDFs together must fit that request, like a
    # single PDF does (MAX_PDF_BYTES). Photos are resampled, so they don't
    # count here.
    if pdf_bytes > MAX_PDF_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"The PDFs in this turn-in come to {pdf_bytes / 1024 / 1024:.1f}MB "
                f"(max {MAX_PDF_BYTES // 1024 // 1024}MB of PDFs). "
                "Take photos of some pages instead, or split the PDF."
            ),
        )
    return validated_files
