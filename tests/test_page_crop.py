"""Cutting a homework photo to its sheet of paper before the reader sees it.

Synthetic photos with known geometry: a page on a dark desk is cut to the
page and nothing else; anything doubtful — a page that already fills the
frame, writing outside the sheet, a soft shadow edge — is left whole;
a sideways page is turned upright only once it is cut.
"""

import base64
import io
import random
from typing import Any

import pytest
from PIL import Image, ImageDraw, ImageOps

from api.core import integrity_ai
from api.core.graph_grading import page_images
from api.core.image_utils import crop_region_for_vision
from api.core.page_crop import crop_page_to_paper, find_page, reader_page, upright_turn

_DESK = (52, 46, 40)
_PAPER = (236, 234, 228)
_INK = (40, 40, 60)


def _written_page(w: int = 850, h: int = 1100, seed: int = 0) -> Image.Image:
    """A portrait sheet with lines of handwriting: each line starts at the
    margin and runs out ragged, and the work fills the top of the page."""
    rng = random.Random(seed)
    page = Image.new("RGB", (w, h), _PAPER)
    d = ImageDraw.Draw(page)
    margin = int(w * 0.1)
    for i in range(22):
        y = int(h * 0.08) + i * int(h * 0.03)
        x, end = margin, margin + int(w * rng.uniform(0.3, 0.8))
        while x < end:
            word = rng.randint(25, 70)
            d.rectangle((x, y, min(x + word, end), y + 12), fill=_INK)
            x += word + rng.randint(10, 18)
    return page


def _photo(page: Image.Image, size: tuple[int, int], at: tuple[int, int]) -> Image.Image:
    photo = Image.new("RGB", size, _DESK)
    photo.paste(page, at)
    return photo


def _b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _decode(data: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(data)))


def test_page_on_a_dark_desk_is_cut_to_the_page() -> None:
    photo = _photo(_written_page(), (2400, 1600), (700, 250))
    box = find_page(photo).box
    assert box is not None
    left, top, right, bottom = box
    # The whole page, with room to spare, and the desk mostly gone.
    assert left <= 700 and top <= 250 and right >= 1550 and bottom >= 1350
    assert left >= 600 and right <= 1650
    assert (right - left) * (bottom - top) < 0.6 * 2400 * 1600


def test_cut_photo_is_reencoded_smaller_and_upright_page_not_turned() -> None:
    photo = _photo(_written_page(), (2400, 1600), (700, 250))
    out = _decode(crop_page_to_paper(_b64(photo), "image/jpeg"))
    assert out.format == "JPEG"
    assert out.height > out.width  # the portrait page, not the landscape photo
    assert out.width < 1100


def test_page_that_fills_the_frame_is_untouched() -> None:
    photo = _photo(_written_page(w=1180, h=1560), (1200, 1600), (10, 20))
    data = _b64(photo)
    assert find_page(photo).box is None
    assert crop_page_to_paper(data, "image/jpeg") == data


def test_writing_outside_the_page_keeps_the_photo_whole() -> None:
    """A second sheet half in shot: its writing must not be cut away."""
    photo = _photo(_written_page(), (2400, 1600), (900, 250))
    second = _written_page(w=300, h=500, seed=3)
    photo.paste(second, (60, 600))
    assert find_page(photo).box is None


def test_ink_at_the_very_edge_of_the_paper_is_kept() -> None:
    page = _written_page()
    d = ImageDraw.Draw(page)
    # A stroke running right up to every edge of the sheet.
    d.line((0, 500, 849, 500), fill=_INK, width=6)
    d.line((425, 0, 425, 1099), fill=_INK, width=6)
    photo = _photo(page, (2400, 1600), (700, 250))
    box = find_page(photo).box
    assert box is not None
    left, top, right, bottom = box
    assert left < 700 and top < 250 and right > 1550 and bottom > 1350


def test_soft_shadow_across_a_full_page_is_not_a_page_edge() -> None:
    """Uneven light makes a bright patch with a blurry edge — the failure
    that once cut half a sheet of graph paper away."""
    w, h = 1600, 2000
    photo = _written_page(w=w, h=h)
    shade = Image.linear_gradient("L").resize((w, h)).point(lambda v: int(v * 0.55))
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    photo = Image.composite(dark, photo, shade)
    assert find_page(photo).box is None


def test_sideways_page_on_a_desk_is_cut_then_turned_upright() -> None:
    upright = _written_page()
    # Lying on its side on the desk: top of the page to the left.
    sideways = upright.rotate(90, expand=True)
    photo = _photo(sideways, (2400, 1600), (600, 300))
    box = find_page(photo).box
    assert box is not None
    assert upright_turn(photo.crop(box)) == 90
    out = reader_page(photo)
    assert out.height > out.width
    # Turned the right way round, not upside down: it matches the page
    # as written far better than the page turned over.
    seen = ImageOps.grayscale(out.crop(out.getbbox() or (0, 0, *out.size)))
    left, top, right, bottom = find_page(photo).box  # type: ignore[misc]
    pad_x, pad_y = (bottom - top - 850) // 2, (right - left - 1100) // 2
    seen = seen.crop((pad_x, pad_y, seen.width - pad_x, seen.height - pad_y)).resize((85, 110))
    as_written = ImageOps.grayscale(upright).resize((85, 110))
    turned_over = as_written.rotate(180)
    assert _distance(seen, as_written) < 0.5 * _distance(seen, turned_over)


def _distance(a: Image.Image, b: Image.Image) -> float:
    pairs = zip(a.get_flattened_data(), b.get_flattened_data(), strict=True)
    return sum(abs(x - y) for x, y in pairs) / (a.width * a.height)


def test_hard_shadow_across_a_full_page_is_not_a_page_edge() -> None:
    """A crisp, straight cast shadow over the bottom of a page that fills
    the frame: the lit part looks like a sheet, but the writing in the
    shadow must not be cut away."""
    photo = _written_page(w=1500, h=2000, seed=5)
    d = ImageDraw.Draw(photo)
    for i in range(6):
        d.rectangle((150, 1450 + i * 70, 1100, 1462 + i * 70), fill=_INK)
    shadow = Image.new("L", photo.size, 0)
    ImageDraw.Draw(shadow).rectangle((0, 1300, 1500, 2000), fill=150)
    photo = Image.composite(Image.new("RGB", photo.size, (0, 0, 0)), photo, shadow)
    assert find_page(photo).box is None


def test_upright_page_is_never_turned() -> None:
    assert upright_turn(_written_page()) == 0


def test_pdf_and_undecodable_uploads_are_untouched() -> None:
    assert crop_page_to_paper("JVBERi0xLjQK", "application/pdf") == "JVBERi0xLjQK"
    assert crop_page_to_paper("bm90IGFuIGltYWdl", "image/jpeg") == "bm90IGFuIGltYWdl"


def test_small_images_are_untouched() -> None:
    photo = _photo(_written_page(w=200, h=260), (600, 400), (200, 70))
    data = _b64(photo)
    assert crop_page_to_paper(data, "image/jpeg") == data


def _red_square_photo() -> tuple[Image.Image, dict[str, float]]:
    """A page on a desk with a red square on it, and where that square sits
    on the page the reader sees (fractions of the cut page)."""
    page = Image.new("RGB", (850, 1100), _PAPER)
    ImageDraw.Draw(page).rectangle((300, 400, 550, 700), fill=(200, 30, 30))
    photo = _photo(page, (2400, 1600), (700, 250))
    box = find_page(photo).box
    assert box is not None
    cw, ch = box[2] - box[0], box[3] - box[1]
    x0, y0 = (700 + 300 - box[0]) / cw, (250 + 400 - box[1]) / ch
    return photo, {"x0": x0, "y0": y0, "x1": x0 + 250 / cw, "y1": y0 + 300 / ch}


def _is_red(data: str) -> bool:
    px = _decode(data).convert("RGB").resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    assert isinstance(px, tuple)
    return px[0] > 150 and px[1] < 90 and px[2] < 90


async def test_drawing_second_look_crops_the_readers_cut_page(monkeypatch: pytest.MonkeyPatch) -> None:
    """The reader's drawing boxes are fractions of the page it saw — the
    cut one — so the zoomed second look must cut the same page first."""
    photo, bbox = _red_square_photo()
    sent: list[str] = []

    async def fake_vision(content: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        sent.append(content[0]["source"]["data"])
        return {"has_drawing": True, "elements": [], "notes": "", "labeled_points": [],
                "unlabeled_dots": 0, "description": "A square."}

    monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
    entry = {"problem_position": 1, "kind": "diagram", "present": True, "description": "",
             "plotted_elements": [], "labeled_points": [], "page_index": 1, "bbox": bbox}
    await integrity_ai.verify_visual_work(
        {"visual_work": [entry]}, [{"data": _b64(photo), "media_type": "image/jpeg"}], flagged_positions={1},
    )
    assert sent
    # The middle of the crop is the red square, not the desk beside it.
    middle = _decode(sent[0])
    w, h = middle.size
    buf = io.BytesIO()
    middle.crop((w // 3, h // 3, 2 * w // 3, 2 * h // 3)).save(buf, format="PNG")
    assert _is_red(base64.b64encode(buf.getvalue()).decode())


def test_graph_check_pages_are_the_readers_cut_pages() -> None:
    photo, bbox = _red_square_photo()
    [[(data, media_type)]] = page_images([{"data": _b64(photo), "media_type": "image/jpeg"}])
    crop = crop_region_for_vision(data, media_type, bbox, margin=0.0, min_frac=0.0)
    assert crop is not None and _is_red(crop)
