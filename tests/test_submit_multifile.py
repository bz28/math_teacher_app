"""Multi-file student submission — coverage that's specific to the
multi-file shape (mixed image+PDF, per-file caps, total-payload guard).

The content-block construction inside extract_student_work is unit-
tested at the helper level by tests/test_image_utils.py (which covers
`to_content_block` for both image and document blocks). The autouse
`_mock_integrity_ai` fixture in conftest replaces `extract_student_work`
wholesale to avoid real Claude calls, so this file deliberately
doesn't exercise the wrapper directly.
"""

from __future__ import annotations

import base64
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from api.database import get_session_factory
from tests.conftest import TINY_PNG

# Magic-byte prefixes for tests that need PDF or JPEG payloads.
_JPEG_HEADER = b"\xff\xd8\xff\xe0\x00\x10JFIF"
_PDF_HEADER = b"%PDF-1.4\n%\xc7\xec\x8f\xa2\n"

TINY_JPEG = base64.b64encode(_JPEG_HEADER + b"jpeg-payload").decode("ascii")
TINY_PDF = base64.b64encode(_PDF_HEADER + b"pdf-payload").decode("ascii")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_submit_homework_accepts_mixed_image_and_pdf(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Submission accepts a list with JPEG, PNG, and PDF in one shot.
    Each file is persisted with its detected media type so the
    extraction pipeline can send the correct content block per file."""
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG, TINY_JPEG, TINY_PDF]},
    )
    assert r.status_code == 200, r.text
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        files = (await s.execute(
            text("SELECT files FROM submissions WHERE id=:id"),
            {"id": submission_id},
        )).scalar_one()
    assert files is not None
    assert len(files) == 3
    media_types = sorted(f["media_type"] for f in files)
    assert media_types == ["application/pdf", "image/jpeg", "image/png"]


async def test_submit_homework_rejects_over_ten_files(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The pydantic field validator caps at 10 files. Eleven returns
    422 (request schema violation, not 400). Real homework submissions
    are 1-3 pages; the cap leaves headroom but rejects pathological
    payloads up front."""
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG] * 11},
    )
    assert r.status_code == 422


async def test_submit_homework_rejects_oversized_image_with_index(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A file over the 5MB image cap is rejected per-file with a
    message naming which index failed — the frontend uses the index
    to highlight the offending row instead of replacing all staged
    files with a generic error. Builds a 6MB PNG-magic blob, which
    is well over the 5MB image cap but well under any web-layer
    body-size middleware (so we exercise our handler, not the
    framework's 413). The PDF cap (25MB) is harder to test through
    HTTP because the payload bloats past framework limits before
    hitting our validator — the validator's per-format split is
    covered directly in tests/test_image_utils.py."""
    # 6 MB raw + PNG header → ~8 MB base64. PNG is capped at 5 MB,
    # so this trips MAX_IMAGE_BYTES inside validate_and_decode_upload.
    oversized_raw = _JPEG_HEADER + b"\x00" * (6 * 1024 * 1024)
    oversized_b64 = base64.b64encode(oversized_raw).decode("ascii")

    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG, oversized_b64]},
    )
    assert r.status_code == 400
    assert "File 2" in r.json()["detail"]


async def test_submit_homework_total_payload_guard_rejects() -> None:
    """The whole-submission cap protects the row store when each file
    passes its per-format cap individually but the sum doesn't (real
    case: 3 large PDFs at 20 MB each → 60 MB total).

    Tested by mocking the per-file validator to claim each file is a
    valid 20 MB PDF, then driving the route handler in-process —
    sending real 60 MB payloads through the test HTTP client trips
    framework body-size middleware before our handler sees the bytes."""
    from unittest.mock import patch

    from fastapi import HTTPException

    from api.routes import school_student_practice as ssp
    from api.routes.school_student_practice import (
        SubmitHomeworkRequest,
        submit_homework,
    )

    # Pretend each file is a valid 20 MB PDF. Three of them total 60 MB
    # which exceeds the 50 MB MAX_SUBMISSION_TOTAL_BYTES.
    fake_decoded = b"\x00" * (20 * 1024 * 1024)
    body = SubmitHomeworkRequest(files=["AAAA", "BBBB", "CCCC"])

    # We don't need a real DB session to hit the cap branch — the
    # handler validates files BEFORE touching the assignment. Use a
    # MagicMock to satisfy the dependency-injected db arg; it's never
    # called on this code path because the cap raises first.
    from unittest.mock import AsyncMock as _AsyncMock
    from unittest.mock import MagicMock

    fake_assignment = MagicMock()
    with (
        patch.object(
            ssp,
            "_load_assignment_for_student",
            new=_AsyncMock(return_value=fake_assignment),
        ),
        patch.object(
            ssp,
            "validate_and_decode_upload",
            return_value=(fake_decoded, "application/pdf"),
        ),
    ):
        # Existence check on the prior submission needs to not match.
        # Easiest path: stub the db.execute chain to return None for
        # the existing-submission scalar. We construct a fake user
        # with an .id attr.
        db = MagicMock()
        existing_result = MagicMock()
        existing_result.scalar_one_or_none.return_value = None
        db.execute = _AsyncMock(return_value=existing_result)

        user = MagicMock()
        user.id = "00000000-0000-0000-0000-000000000001"

        try:
            await submit_homework(
                assignment_id="00000000-0000-0000-0000-000000000002",
                body=body,
                user=user,
                db=db,
            )
        except HTTPException as exc:
            assert exc.status_code == 413
            assert "Submission too large" in exc.detail
            return
    raise AssertionError("expected total-payload guard to trip")


