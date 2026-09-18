"""The drawings channel's second look (`verify_visual_work`) and its crop
helper. No LLM calls — the vision call is stubbed.

Guards the mechanism that fixed the Sep 2026 "solve by graphing" misgrades:
  - the crop is taken from the ORIENTED page in normalized coords, padded,
    and enlarged;
  - the crop's inventory REPLACES the primed full-page one;
  - a "no drawing here" crop gets one wider retry, then empties the
    inventory and says so in the description;
  - absent / unusable bbox, non-present entries, and verify failures leave
    the entry untouched (never fail the extraction).
"""

from __future__ import annotations

import base64
import io
from typing import Any

import pytest
from PIL import Image

from api.core import integrity_ai
from api.core.image_utils import crop_region_for_vision


def _page(w: int = 800, h: int = 1000) -> str:
    img = Image.new("RGB", (w, h), "white")
    # A dark square at the bottom-right quadrant so a crop there is non-white.
    for x in range(600, 700):
        for y in range(800, 900):
            img.putpixel((x, y), (0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def _decode(b64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(b64)))


class TestCropRegion:
    def test_crop_is_padded_enlarged_and_from_the_right_place(self) -> None:
        crop = crop_region_for_vision(_page(), "image/jpeg", {"x0": 0.75, "y0": 0.8, "x1": 0.875, "y1": 0.9})
        assert crop is not None
        img = _decode(crop)
        assert max(img.size) >= 1200  # upscaled so strokes have pixels
        # The dark square must be inside the crop: some pixels are near-black.
        px = list(img.convert("L").getdata())
        assert min(px) < 40
        # And it's a crop, not the whole page — mostly white, not all.
        assert sum(1 for p in px if p < 40) < len(px) // 2

    @pytest.mark.parametrize("bbox", [
        {"x0": 0.5, "y0": 0.5, "x1": 0.4, "y1": 0.9},  # inverted
        {"x0": -0.1, "y0": 0.5, "x1": 0.4, "y1": 0.9},  # out of range
        {"x0": "a", "y0": 0.5, "x1": 0.4, "y1": 0.9},  # garbage
        {},
    ])
    def test_unusable_bbox_returns_none(self, bbox: dict[str, Any]) -> None:
        assert crop_region_for_vision(_page(), "image/jpeg", bbox) is None

    def test_non_image_returns_none(self) -> None:
        assert crop_region_for_vision("JVBERi0=", "application/pdf", {"x0": 0, "y0": 0, "x1": 1, "y1": 1}) is None


def _entry(**over: Any) -> dict[str, Any]:
    base = {
        "problem_position": 4, "kind": "graph", "present": True,
        "description": "Two lines plotted intersecting at (2, 3).",  # the primed claim
        "plotted_elements": ["line (y = 2x - 1)", "line (y = -x + 5)"],
        "labeled_points": ["(2, 3)"], "answer_on_drawing": "(2, 3)",
        "page_index": 1, "bbox": {"x0": 0.5, "y0": 0.3, "x1": 0.9, "y1": 0.5},
    }
    return {**base, **over}


class TestVerifyVisualWork:
    async def test_crop_inventory_replaces_the_primed_one(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls: list[dict[str, Any]] = []

        async def fake_vision(content: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
            calls.append({"content": content, **kwargs})
            return {
                "has_drawing": True,
                "plotted_elements": ["one line rising left-to-right through the origin"],
                "labeled_points": [], "unlabeled_dots": 2, "answer_on_drawing": None,
                "description": "Axes with tick marks and a single line; two unlabeled dots.",
            }

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
        await integrity_ai.verify_visual_work(ext, [{"data": _page(), "media_type": "image/jpeg"}])
        v = ext["visual_work"][0]
        assert v["verified"] is True
        assert v["plotted_elements"] == ["one line rising left-to-right through the origin"]
        assert v["labeled_points"] == [] and v["answer_on_drawing"] is None
        assert "single line" in v["description"]
        assert v["present"] is True  # the second look never flips presence
        assert len(calls) == 1
        # The verify call carries the crop, not the page, and no problem text.
        assert calls[0]["content"][0]["type"] == "image"
        assert "y = 2x" not in calls[0]["content"][1]["text"]
        assert calls[0]["call_metadata"]["phase"] == "vision_verify_drawing"

    async def test_no_drawing_retries_wider_then_empties_inventory(self, monkeypatch: pytest.MonkeyPatch) -> None:
        margins: list[float] = []

        async def fake_vision(content: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
            margins.append(kwargs["call_metadata"]["margin"])
            return {"has_drawing": False, "plotted_elements": [], "labeled_points": [],
                    "unlabeled_dots": 0, "answer_on_drawing": None, "description": "Only text."}

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
        await integrity_ai.verify_visual_work(ext, [{"data": _page(), "media_type": "image/jpeg"}])
        v = ext["visual_work"][0]
        assert margins == [0.35, 0.8]
        assert v["verified"] is True
        assert v["plotted_elements"] == [] and v["labeled_points"] == [] and v["answer_on_drawing"] is None
        assert "could not be confirmed" in v["description"]
        assert "Two lines" not in v["description"]

    async def test_retry_stops_once_a_drawing_is_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        answers = iter([
            {"has_drawing": False, "plotted_elements": [], "labeled_points": [], "unlabeled_dots": 0,
             "answer_on_drawing": None, "description": ""},
            {"has_drawing": True, "plotted_elements": ["a line"], "labeled_points": ["(3, 0)"],
             "unlabeled_dots": 0, "answer_on_drawing": "(3, 0)", "description": "found it"},
        ])
        n = 0

        async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
            nonlocal n
            n += 1
            return next(answers)

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
        await integrity_ai.verify_visual_work(ext, [{"data": _page(), "media_type": "image/jpeg"}])
        v = ext["visual_work"][0]
        assert n == 2 and v["plotted_elements"] == ["a line"] and v["answer_on_drawing"] == "(3, 0)"

    @pytest.mark.parametrize("over", [
        {"present": False},
        {"bbox": None},
        {"bbox": {"x0": 0.9, "y0": 0.1, "x1": 0.2, "y1": 0.5}},
        {"page_index": 7},
    ])
    async def test_untouched_when_it_cannot_look(self, monkeypatch: pytest.MonkeyPatch, over: dict[str, Any]) -> None:
        async def boom(*args: Any, **kwargs: Any) -> dict[str, Any]:
            raise AssertionError("should not be called")

        monkeypatch.setattr(integrity_ai, "call_claude_vision", boom)
        entry = _entry(**over)
        ext = {"steps": [], "final_answers": [], "visual_work": [entry], "confidence": 0.9}
        await integrity_ai.verify_visual_work(ext, [{"data": _page(), "media_type": "image/jpeg"}])
        v = ext["visual_work"][0]
        assert v["plotted_elements"] == entry["plotted_elements"]
        assert v.get("verified", False) is False

    async def test_single_page_infers_page_index(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
            return {"has_drawing": True, "plotted_elements": ["x"], "labeled_points": [],
                    "unlabeled_dots": 0, "answer_on_drawing": None, "description": "d"}

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry(page_index=None)], "confidence": 0.9}
        await integrity_ai.verify_visual_work(ext, [{"data": _page(), "media_type": "image/jpeg"}])
        assert ext["visual_work"][0]["verified"] is True

    async def test_no_drawing_with_no_wider_crop_is_not_trusted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """If the wider retry can't even be cropped, one 'nothing here'
        look must not stand as verified."""
        from api.core import image_utils

        async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
            return {"has_drawing": False, "plotted_elements": [], "labeled_points": [],
                    "unlabeled_dots": 0, "answer_on_drawing": None, "description": ""}

        real = image_utils.crop_region_for_vision

        def crop_once(*args: Any, **kwargs: Any) -> str | None:
            return None if kwargs.get("margin") == 0.8 else real(*args, **kwargs)

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        monkeypatch.setattr(integrity_ai, "crop_region_for_vision", crop_once)
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
        await integrity_ai.verify_visual_work(ext, [{"data": _page(), "media_type": "image/jpeg"}])
        v = ext["visual_work"][0]
        assert v["verified"] is False and v["plotted_elements"] == ["line (y = 2x - 1)", "line (y = -x + 5)"]

    async def test_bounded_and_concurrent(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio

        active = 0
        peak = 0
        n = 0

        async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
            nonlocal active, peak, n
            active += 1
            peak = max(peak, active)
            n += 1
            await asyncio.sleep(0.01)
            active -= 1
            return {"has_drawing": True, "plotted_elements": ["x"], "labeled_points": [],
                    "unlabeled_dots": 0, "answer_on_drawing": None, "description": "d"}

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        entries = [_entry(problem_position=i) for i in range(1, 10)]  # 9 drawings
        ext = {"steps": [], "final_answers": [], "visual_work": entries, "confidence": 0.9}
        await integrity_ai.verify_visual_work(ext, [{"data": _page(), "media_type": "image/jpeg"}])
        assert n == integrity_ai._VERIFY_MAX_DRAWINGS
        assert 1 < peak <= integrity_ai._VERIFY_CONCURRENCY
        assert sum(1 for v in ext["visual_work"] if v["verified"]) == integrity_ai._VERIFY_MAX_DRAWINGS
        assert all(v["verified"] is False for v in ext["visual_work"][integrity_ai._VERIFY_MAX_DRAWINGS:])

    async def test_unexpected_crash_never_fails_extraction(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A malformed file entry (not a dict) must not strand the
        submission — the extraction lands with the entry unverified."""
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
        await integrity_ai.verify_visual_work(ext, ["not-a-file-dict"])  # type: ignore[list-item]
        v = ext["visual_work"][0]
        assert v["verified"] is False and v["plotted_elements"] == ["line (y = 2x - 1)", "line (y = -x + 5)"]

    async def test_vision_failure_leaves_entry_unverified(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def fail(*args: Any, **kwargs: Any) -> dict[str, Any]:
            raise RuntimeError("api down")

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fail)
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
        await integrity_ai.verify_visual_work(ext, [{"data": _page(), "media_type": "image/jpeg"}])
        v = ext["visual_work"][0]
        assert v["verified"] is False and v["plotted_elements"] == ["line (y = 2x - 1)", "line (y = -x + 5)"]
