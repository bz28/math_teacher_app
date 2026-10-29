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
import io
from typing import Any

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import text

from api.database import get_session_factory
from tests.conftest import PAGE_PNG

# Magic-byte prefixes for tests that need PDF or JPEG payloads.
_JPEG_HEADER = b"\xff\xd8\xff\xe0\x00\x10JFIF"
_PDF_HEADER = b"%PDF-1.4\n%\xc7\xec\x8f\xa2\n"

TINY_PDF = base64.b64encode(_PDF_HEADER + b"pdf-payload").decode("ascii")


def _real_jpeg(size: tuple[int, int]) -> str:
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


PAGE_JPEG = _real_jpeg((800, 600))


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
        json={"files": [PAGE_PNG, PAGE_JPEG, TINY_PDF]},
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
        json={"files": [PAGE_PNG] * 11},
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
        json={"files": [PAGE_PNG, oversized_b64]},
    )
    assert r.status_code == 400
    assert "File 2" in r.json()["detail"]


async def test_submit_stores_each_page_the_way_the_student_turned_it(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A page rotated on the upload screen is saved upright, so the AI
    reader and the teacher's photo view both get it that way — a PDF's
    pages too. Pages with no turn are stored exactly as sent."""
    from tests.test_image_utils import pdf_of

    wide = _real_jpeg((800, 400))
    wide_pdf = pdf_of([Image.new("RGB", (800, 400), "white")])
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [wide, wide, TINY_PDF, wide_pdf], "rotations": [90, 0, 0, 90]},
    )
    assert r.status_code == 200, r.text

    async with get_session_factory()() as s:
        files = (await s.execute(
            text("SELECT files FROM submissions WHERE id=:id"),
            {"id": r.json()["submission_id"]},
        )).scalar_one()
    turned = Image.open(io.BytesIO(base64.b64decode(files[0]["data"])))
    assert turned.size == (400, 800)
    assert files[1]["data"] == wide
    assert files[2]["data"] == TINY_PDF
    from api.core.image_utils import pdf_pages_as_images

    [page] = pdf_pages_as_images(files[3]["data"])
    page_img = Image.open(io.BytesIO(base64.b64decode(page)))
    assert page_img.width < page_img.height


async def test_submit_refuses_to_turn_a_decompression_bomb(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    buf = io.BytesIO()
    Image.new("1", (12000, 12000)).save(buf, format="PNG")
    bomb = base64.b64encode(buf.getvalue()).decode("ascii")
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [bomb], "rotations": [90]},
    )
    assert r.status_code == 400
    assert "File 1" in r.json()["detail"]


async def test_submit_rejects_rotations_that_dont_line_up(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    url = f"/v1/school/student/homework/{world['assignment_id']}/submit"
    for rotations in ([90], [45, 0]):
        r = await client.post(
            url, headers=_auth(world["student_token"]),
            json={"files": [PAGE_PNG, PAGE_PNG], "rotations": rotations},
        )
        assert r.status_code == 422, rotations


async def test_page_orientation_check(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The nudge's backend: a free pixel check. Bad input is a 400, not
    a silent 'upright'; no token is a 401."""
    from tests.test_image_utils import _page_of_writing

    def enc(img: Image.Image) -> str:
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        return base64.b64encode(buf.getvalue()).decode("ascii")

    url = "/v1/school/student/homework/page-orientation"
    page = _page_of_writing()
    for img, expected in ((page, False), (page.rotate(90, expand=True), True)):
        r = await client.post(
            url, headers=_auth(world["student_token"]), json={"image": enc(img)},
        )
        assert r.status_code == 200, r.text
        assert r.json() == {
            "sideways": expected, "page_count": 1,
            "sideways_pages": [1] if expected else [],
            "too_small_pages": [], "preview": None,
        }

    r = await client.post(
        url, headers=_auth(world["student_token"]),
        json={"image": base64.b64encode(b"not a page").decode()},
    )
    assert r.status_code == 400
    r = await client.post(url, json={"image": enc(page)})
    assert r.status_code == 401


async def test_page_orientation_check_reads_every_pdf_page(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A PDF gets the photo checks page by page, as the reader sees it:
    the sideways page and the page too small to read are both named."""
    from tests.test_image_utils import _page_of_writing, pdf_of

    page = _page_of_writing()
    pdf = pdf_of([page, page.rotate(90, expand=True), page.resize((240, 320))])
    r = await client.post(
        "/v1/school/student/homework/page-orientation",
        headers=_auth(world["student_token"]), json={"image": pdf},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sideways"] is True
    assert body["page_count"] == 3
    assert body["sideways_pages"] == [2]
    assert body["too_small_pages"] == [3]
    assert body["preview"]

    # A PDF it can't open: no pages, no claims about them.
    r = await client.post(
        "/v1/school/student/homework/page-orientation",
        headers=_auth(world["student_token"]), json={"image": TINY_PDF},
    )
    assert r.status_code == 200, r.text
    assert r.json()["page_count"] == 0
    assert r.json()["sideways"] is False


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
        # A bare MagicMock attribute is truthy, which would read as a
        # teacher's preview shadow and get refused before the payload
        # guard runs. This test is about a real student's upload.
        user.is_preview = False

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




@pytest.mark.parametrize("size", [(320, 240), (240, 320)])
async def test_submit_refuses_a_page_too_small_to_read(
    client: AsyncClient, world: dict[str, Any], size: tuple[int, int],
) -> None:
    """Prod, Oct 2026: 320×240 pages were read as tidy textbook solutions
    the student never wrote. The student is told to retake the page."""
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [PAGE_PNG, _real_jpeg(size)]},
    )
    assert r.status_code == 400
    assert r.json()["detail"].startswith("File 2 is too small to read")


async def test_submit_accepts_a_page_at_the_minimum_size(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [_real_jpeg((400, 300))]},
    )
    assert r.status_code == 200, r.text


async def test_submit_refuses_bytes_that_only_look_like_a_jpeg(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    fake = base64.b64encode(_JPEG_HEADER + b"jpeg-payload").decode("ascii")
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [fake]},
    )
    assert r.status_code == 400
    assert "File 1" in r.json()["detail"]


async def test_submit_refuses_a_pdf_page_too_small_to_read(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The teacher report behind this: a phone photo saved as a PDF was
    read as badly as the photo would have been. A PDF page is held to
    the photo's size floor, and the message names the page."""
    from tests.test_image_utils import pdf_of

    pdf = pdf_of([Image.new("RGB", (1600, 1200), "white"), Image.new("RGB", (320, 240), "white")])
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [PAGE_PNG, pdf]},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == (
        "File 2, page 2 is too small to read (320px). "
        "Take it again closer up, so the page fills the screen."
    )


async def test_submit_accepts_pdf_pages_at_the_minimum_size_and_typed_pages(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """At the floor is fine, and a typed page has no pixel size to fail."""
    import pypdfium2 as pdfium

    from tests.test_image_utils import pdf_of

    typed = pdfium.PdfDocument.new()
    typed.new_page(612, 792)
    buf = io.BytesIO()
    typed.save(buf)
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [
            pdf_of([Image.new("RGB", (400, 300), "white")]),
            base64.b64encode(buf.getvalue()).decode("ascii"),
        ]},
    )
    assert r.status_code == 200, r.text
