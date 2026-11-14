"""The reader sends a PDF as images it rendered, not as a document.

Sent as a `document`, every PDF page is rasterized by the API at a fixed
~1.2 MP whatever it holds, so a phone photo printed to PDF (Google Docs,
a browser, Gmail) reached the reader far smaller than the photo itself.
Prod, Nov 2026: a 4096 px collage printed from Gmail read "3π/4" as the
answer key's "3π/2"; the same photo sent as an image read it right.

These tests assert on the request the reader builds: which blocks, how
big, and how they're labelled — `page_index` must still mean "file N".
"""

from __future__ import annotations

import base64
import io
from typing import Any

import pytest
from PIL import Image

from api.core import integrity_ai
from api.core.image_utils import READER_MAX_EDGE, READER_MAX_PIXELS
from tests.test_image_utils import _CHROME, _corners, printed_pdf

pytestmark = pytest.mark.anyio


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []

    async def _fake_vision(blocks: list[dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
        content.extend(blocks)
        return {"steps": [], "final_answers": [], "visual_work": [], "confidence": 0.9}

    async def _no_verify(*args: Any, **kwargs: Any) -> None:
        return None

    monkeypatch.setattr(integrity_ai, "call_claude_vision", _fake_vision)
    monkeypatch.setattr(integrity_ai, "verify_visual_work", _no_verify)
    return content


def _shape(content: list[dict[str, Any]]) -> list[str]:
    """Labels as text, every other block as its type."""
    return [b["text"] if b["type"] == "text" else b["type"] for b in content[:-1]]


def _size(block: dict[str, Any]) -> tuple[int, int]:
    with Image.open(io.BytesIO(base64.b64decode(block["source"]["data"]))) as img:
        return img.size


def _two_page(first: str, second: str) -> str:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(base64.b64decode(first))
    pdf.import_pages(pdfium.PdfDocument(base64.b64decode(second)))
    buf = io.BytesIO()
    pdf.save(buf)
    return base64.b64encode(buf.getvalue()).decode()


async def test_a_printed_photo_goes_as_the_photo(sent: list[dict[str, Any]]) -> None:
    pdf = printed_pdf(_corners((1500, 2000)), texts=_CHROME)
    await integrity_ai.extract_student_work_from_pages([{"data": pdf, "media_type": "application/pdf"}])
    assert _shape(sent) == ["--- Page 1 of 1 ---", "image"]
    block = sent[1]
    assert block["source"]["media_type"] == "image/jpeg"
    # Cut to the photo and fitted like a photo upload: the photo fills the
    # reader's box (here its 3.75 MP cap, a 3:4 page's long edge ~2236 px),
    # where the whole Letter page gave it ~79% of ~1250 px.
    w, h = _size(block)
    assert abs(w / h - 0.75) < 0.02
    assert h <= READER_MAX_EDGE and w * h <= READER_MAX_PIXELS and w * h > 0.99 * READER_MAX_PIXELS


async def test_a_pdf_page_reaches_the_reader_at_the_reader_size(sent: list[dict[str, Any]]) -> None:
    # A typed page (vector text, no picture to hold it to) is rendered at
    # the reader's long edge, then fitted to its pixel cap — not rendered
    # at 2400 and shrunk to 1568 as before.
    pdf = printed_pdf(None, texts=(("1. x = 3", 72, 400), ("2. y = 4", 72, 300)))
    await integrity_ai.extract_student_work_from_pages([{"data": pdf, "media_type": "application/pdf"}])
    w, h = _size(sent[1])
    assert sent[1]["source"]["media_type"] == "image/jpeg"
    assert h <= READER_MAX_EDGE and w * h <= READER_MAX_PIXELS and h > 2000


async def test_a_multi_page_pdf_is_parts_of_its_files_page(sent: list[dict[str, Any]]) -> None:
    jpeg = io.BytesIO()
    Image.new("RGB", (600, 800), "white").save(jpeg, format="JPEG")
    photo = base64.b64encode(jpeg.getvalue()).decode()
    pdf = _two_page(printed_pdf(_corners((1500, 2000))), printed_pdf(None, texts=(("1. x = 3", 72, 400),)))
    await integrity_ai.extract_student_work_from_pages([
        {"data": f"data:image/jpeg;base64,{photo}", "media_type": "image/jpeg"},
        {"data": pdf, "media_type": "application/pdf"},
    ])
    assert _shape(sent) == [
        "--- Page 1 of 2 ---", "image",
        "--- Page 2 of 2, part 1 of 2 ---", "image",
        "--- Page 2 of 2, part 2 of 2 ---", "image",
    ]
    # The photo upload is fitted to the reader on its own terms: a small
    # page is enlarged, never left at 600 px.
    w, h = _size(sent[1])
    assert sent[1]["source"]["media_type"] == "image/jpeg" and abs(w / h - 0.75) < 0.01
    assert h <= READER_MAX_EDGE and w * h <= READER_MAX_PIXELS and h > 2200


async def test_a_pdf_pdfium_cant_read_still_goes_as_a_document(sent: list[dict[str, Any]]) -> None:
    junk = base64.b64encode(b"%PDF-1.4\nnot really").decode()
    await integrity_ai.extract_student_work_from_pages([{"data": junk, "media_type": "application/pdf"}])
    assert _shape(sent) == ["--- Page 1 of 1 ---", "document"]
    assert sent[1]["source"]["data"] == junk


async def test_a_pdf_past_the_page_cap_goes_whole_as_a_document(
    sent: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    # Rendering only the first pages would silently drop the rest of the
    # student's work; the document path reads every page.
    from api.core import image_utils

    monkeypatch.setattr(image_utils, "_PDF_MAX_PAGES", 1)
    pdf = _two_page(printed_pdf(_corners((1500, 2000))), printed_pdf(_corners((1500, 2000))))
    await integrity_ai.extract_student_work_from_pages([{"data": pdf, "media_type": "application/pdf"}])
    assert _shape(sent) == ["--- Page 1 of 1 ---", "document"]
    assert sent[1]["source"]["data"] == pdf


async def test_a_page_that_wont_render_sends_the_whole_pdf_as_a_document(
    sent: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    import pypdfium2 as pdfium

    real_render = pdfium.PdfPage.render
    calls = {"n": 0}

    def flaky(self: Any, *a: Any, **k: Any) -> Any:
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("bad page")
        return real_render(self, *a, **k)

    monkeypatch.setattr(pdfium.PdfPage, "render", flaky)
    pdf = _two_page(printed_pdf(_corners((1500, 2000))), printed_pdf(_corners((1500, 2000))))
    await integrity_ai.extract_student_work_from_pages([{"data": pdf, "media_type": "application/pdf"}])
    assert calls["n"] == 2
    assert _shape(sent) == ["--- Page 1 of 1 ---", "document"]
    assert sent[1]["source"]["data"] == pdf
