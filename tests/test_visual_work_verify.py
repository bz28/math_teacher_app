"""The drawings channel's second look (`verify_visual_work`) and its crop
helper. No LLM calls — the vision call is stubbed.

Guards the mechanism that fixed the Sep 2026 "solve by graphing" misgrades:
  - the crop is taken from the ORIENTED page in normalized coords, padded,
    and enlarged;
  - the crop's inventory REPLACES the primed full-page one;
  - a "no drawing here" crop gets one wider retry, then empties the
    inventory and marks the entry unconfirmed (never verified, and no
    pipeline text in the teacher-visible description);
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


# Every test position is on a problem that requires a drawing, unless a
# test says otherwise — the verify pass only looks at those.
_FLAGGED = set(range(1, 20))


def _lines(descs: list[str]) -> list[dict[str, str]]:
    """The verify schema's typed elements, all plotted lines."""
    return [{"type": "line", "description": d} for d in descs]


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
                "elements": _lines(["one line rising left-to-right through the origin"]), "notes": "",
                "labeled_points": ["(2,3)"], "unlabeled_dots": 2,
                "description": "Axes with tick marks and a single line; two unlabeled dots.",
            }

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
        await integrity_ai.verify_visual_work(
            ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
        )
        v = ext["visual_work"][0]
        assert v["verified"] is True
        assert v["plotted_elements"] == ["one line rising left-to-right through the origin"]
        # The answer on the drawing comes from the first read (it has the
        # question); the matching labeled point keeps the first read's text.
        assert v["labeled_points"] == ["(2, 3)"] and v["answer_on_drawing"] == "(2, 3)"
        assert "single line" in v["description"]
        assert v["present"] is True  # the second look never flips presence
        assert len(calls) == 1
        # The verify call carries the crop, not the page, and no problem text.
        assert calls[0]["content"][0]["type"] == "image"
        assert "y = 2x" not in calls[0]["content"][1]["text"]
        assert calls[0]["call_metadata"]["phase"] == "vision_verify_drawing"

    async def test_agreeing_crop_confirms_and_keeps_the_first_read(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """drawing-eval case a: both lines read correctly first; the crop
        agreed on the count but described one as a curve with the wrong
        intercepts, and the grader docked a correct graph to 50%."""
        async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
            return {
                "has_drawing": True,
                "elements": _lines(["a curve through the origin", "a steep falling line"]), "notes": "",
                "labeled_points": ["(2,3)"], "unlabeled_dots": 0, "answer_on_drawing": "(2,3)",
                "description": "A curve and a line.",
            }

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        entry = _entry()
        ext = {"steps": [], "final_answers": [], "visual_work": [entry], "confidence": 0.9}
        await integrity_ai.verify_visual_work(
            ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
        )
        v = ext["visual_work"][0]
        assert v["verified"] is True and "unconfirmed" not in v
        assert v["plotted_elements"] == ["line (y = 2x - 1)", "line (y = -x + 5)"]
        assert v["description"] == "Two lines plotted intersecting at (2, 3)."

    async def test_no_drawing_retries_wider_then_empties_inventory(self, monkeypatch: pytest.MonkeyPatch) -> None:
        margins: list[float] = []

        async def fake_vision(content: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
            margins.append(kwargs["call_metadata"]["margin"])
            return {"has_drawing": False, "elements": _lines([]), "notes": "", "labeled_points": [],
                    "unlabeled_dots": 0, "answer_on_drawing": None, "description": "Only text."}

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
        await integrity_ai.verify_visual_work(
            ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
        )
        v = ext["visual_work"][0]
        assert margins == [0.35, 0.8]
        # Finding nothing is NOT a confirmation (prod bb8536f1: a proof's
        # Statements|Reasons columns logged as a "table" showed the
        # teacher "checked ✓" beside pipeline prose).
        assert v["verified"] is False
        assert v["unconfirmed"] is True
        # Nothing erased: the grader withholds an unconfirmed inventory,
        # and the teacher sees the first read framed as a claim.
        assert v["plotted_elements"] == ["line (y = 2x - 1)", "line (y = -x + 5)"]
        assert v["labeled_points"] == ["(2, 3)"]
        # The teacher-visible description stays the first pass's own
        # words — never internal pipeline status text.
        assert v["description"] == "Two lines plotted intersecting at (2, 3)."
        assert "zoomed" not in v["description"].lower()

    async def test_retry_stops_once_a_drawing_is_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        answers = iter([
            {"has_drawing": False, "elements": _lines([]), "notes": "", "labeled_points": [], "unlabeled_dots": 0,
             "answer_on_drawing": None, "description": ""},
            {"has_drawing": True, "elements": _lines(["a line"]), "notes": "", "labeled_points": ["(2, 3)"],
             "unlabeled_dots": 0, "description": "found it"},
        ])
        n = 0

        async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
            nonlocal n
            n += 1
            return next(answers)

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
        await integrity_ai.verify_visual_work(
            ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
        )
        v = ext["visual_work"][0]
        assert n == 2 and v["plotted_elements"] == ["a line"] and v["answer_on_drawing"] == "(2, 3)"
        assert v["verified"] is True and "unconfirmed" not in v

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
        await integrity_ai.verify_visual_work(
            ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
        )
        v = ext["visual_work"][0]
        assert v["plotted_elements"] == entry["plotted_elements"]
        assert v.get("verified", False) is False

    async def test_single_page_infers_page_index(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
            return {"has_drawing": True, "elements": _lines(["x"]), "notes": "", "labeled_points": ["(2, 3)"],
                    "unlabeled_dots": 0, "answer_on_drawing": None, "description": "d"}

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry(page_index=None)], "confidence": 0.9}
        await integrity_ai.verify_visual_work(
            ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
        )
        assert ext["visual_work"][0]["verified"] is True

    async def test_no_drawing_with_no_wider_crop_is_not_trusted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """If the wider retry can't even be cropped, one 'nothing here'
        look must not stand as verified."""
        from api.core import image_utils

        async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
            return {"has_drawing": False, "elements": _lines([]), "notes": "", "labeled_points": [],
                    "unlabeled_dots": 0, "answer_on_drawing": None, "description": ""}

        real = image_utils.crop_region_for_vision

        def crop_once(*args: Any, **kwargs: Any) -> str | None:
            return None if kwargs.get("margin") == 0.8 else real(*args, **kwargs)

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        monkeypatch.setattr(integrity_ai, "crop_region_for_vision", crop_once)
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
        await integrity_ai.verify_visual_work(
            ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
        )
        v = ext["visual_work"][0]
        assert v["verified"] is False and v["plotted_elements"] == ["line (y = 2x - 1)", "line (y = -x + 5)"]
        assert "unconfirmed" not in v

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
            return {"has_drawing": True, "elements": _lines(["x"]), "notes": "", "labeled_points": ["(2, 3)"],
                    "unlabeled_dots": 0, "answer_on_drawing": None, "description": "d"}

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        entries = [_entry(problem_position=i) for i in range(1, 10)]  # 9 drawings
        ext = {"steps": [], "final_answers": [], "visual_work": entries, "confidence": 0.9}
        await integrity_ai.verify_visual_work(
            ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
        )
        assert n == integrity_ai._VERIFY_MAX_DRAWINGS
        assert 1 < peak <= integrity_ai._VERIFY_CONCURRENCY
        assert sum(1 for v in ext["visual_work"] if v["verified"]) == integrity_ai._VERIFY_MAX_DRAWINGS
        assert all(v["verified"] is False for v in ext["visual_work"][integrity_ai._VERIFY_MAX_DRAWINGS:])

    async def test_unexpected_crash_never_fails_extraction(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A malformed file entry (not a dict) must not strand the
        submission — the extraction lands with the entry unverified."""
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
        await integrity_ai.verify_visual_work(
            ext, ["not-a-file-dict"], flagged_positions=_FLAGGED,  # type: ignore[list-item]
        )
        v = ext["visual_work"][0]
        assert v["verified"] is False and v["plotted_elements"] == ["line (y = 2x - 1)", "line (y = -x + 5)"]
        assert "unconfirmed" not in v

    async def test_vision_failure_leaves_entry_unverified(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def fail(*args: Any, **kwargs: Any) -> dict[str, Any]:
            raise RuntimeError("api down")

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fail)
        ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
        await integrity_ai.verify_visual_work(
            ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
        )
        v = ext["visual_work"][0]
        assert v["verified"] is False and v["plotted_elements"] == ["line (y = 2x - 1)", "line (y = -x + 5)"]
        assert "unconfirmed" not in v


async def test_tables_are_never_sent_to_the_zoomed_check(monkeypatch: pytest.MonkeyPatch) -> None:
    """The zoomed look ignores text, so for a table it can only say "no
    drawing" — which used to turn a required table into a false
    "couldn't confirm". Tables stay unverified and are never unconfirmed."""
    async def boom(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise AssertionError("a table must not be sent to the verify pass")

    monkeypatch.setattr(integrity_ai, "call_claude_vision", boom)
    table = _entry(kind="table", description="x | y table of values", plotted_elements=[])
    ext = {"steps": [], "final_answers": [], "visual_work": [table], "confidence": 0.9}
    await integrity_ai.verify_visual_work(
        ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
    )
    v = ext["visual_work"][0]
    assert v["verified"] is False and "unconfirmed" not in v
    assert v["description"] == "x | y table of values"


def test_table_is_a_drawing_kind_again() -> None:
    """A required table of values is real drawn work; "table" stays a kind.
    The proof-grid false positives are handled by the requires_drawing
    gate instead (see test_extraction_post_filter)."""
    from api.core.llm_schemas import INTEGRITY_EXTRACT_SCHEMA

    item = INTEGRITY_EXTRACT_SCHEMA["input_schema"]["properties"]["visual_work"]["items"]
    assert "table" in item["properties"]["kind"]["enum"]


async def test_unflagged_problems_are_recorded_but_never_verified(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Record everywhere, act only where required: a drawing on a problem
    that doesn't require one stays exactly as the first read recorded it."""
    async def boom(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise AssertionError("an unflagged problem's drawing must not be verified")

    monkeypatch.setattr(integrity_ai, "call_claude_vision", boom)
    entry = _entry(problem_position=3)
    ext = {"steps": [], "final_answers": [], "visual_work": [dict(entry)], "confidence": 0.9}
    await integrity_ai.verify_visual_work(
        ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions={1},
    )
    assert ext["visual_work"] == [entry]


def test_briefing_is_unmarked_and_prompt_records_everywhere() -> None:
    """The flag gates USE, not recording: the extractor is not told which
    problems are flagged, and the prompt inventories every drawing."""
    briefing = integrity_ai._format_problems_briefing(
        [{"position": 1, "question": "Solve by graphing.", "requires_drawing": True}]
    )
    assert "requires a drawing" not in briefing
    assert "For every graph, number line, diagram, table, or sketch" in integrity_ai._EXTRACT_SYSTEM
    # The tool schema is part of the prompt too — it must not gate either.
    from api.core.llm_schemas import INTEGRITY_EXTRACT_SCHEMA

    schema_text = str(INTEGRITY_EXTRACT_SCHEMA)
    assert "requires a drawing" not in schema_text
    assert "Never for unmarked problems" not in schema_text
    vw = INTEGRITY_EXTRACT_SCHEMA["input_schema"]["properties"]["visual_work"]
    assert vw["description"].startswith("One entry per drawing the student made")


async def test_points_disagreement_marks_unconfirmed_not_replaced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same line count, but the crop reads a different labeled point: that
    is a doubt for the teacher, not a silent correction."""
    async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"has_drawing": True, "elements": _lines(["a", "b"]), "notes": "",
                "labeled_points": ["(1, 3)"], "unlabeled_dots": 0, "description": "two lines"}

    monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
    ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
    await integrity_ai.verify_visual_work(
        ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
    )
    v = ext["visual_work"][0]
    assert v["verified"] is False and v["unconfirmed"] is True
    assert v["unconfirmed_reason"] == "labeled_points_disagree"
    assert v["zoomed_labeled_points"] == ["(1, 3)"]
    # nothing silently rewritten
    assert v["labeled_points"] == ["(2, 3)"] and v["answer_on_drawing"] == "(2, 3)"
    assert v["plotted_elements"] == ["line (y = 2x - 1)", "line (y = -x + 5)"]


async def test_an_observation_is_not_a_plotted_line(monkeypatch: pytest.MonkeyPatch) -> None:
    """drawing-eval case e: the crop added "the two lines intersect near
    the y-axis" as a third element and the count mismatch made it win.
    Notes, points and 'other' marks never count as plotted lines."""
    async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"has_drawing": True,
                "elements": [{"type": "line", "description": "rising"},
                             {"type": "line", "description": "falling"},
                             {"type": "point", "description": "circled dot"},
                             {"type": "other", "description": "the lines intersect"}],
                "notes": "The two lines intersect near the y-axis.",
                "labeled_points": ["(2, 3)"], "unlabeled_dots": 0, "description": "two lines"}

    monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
    ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
    await integrity_ai.verify_visual_work(
        ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
    )
    v = ext["visual_work"][0]
    assert v["verified"] is True and "unconfirmed" not in v
    assert v["plotted_elements"] == ["line (y = 2x - 1)", "line (y = -x + 5)"]


async def test_the_answer_on_a_number_line_stays_the_first_reads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """drawing-eval case d: the context-free crop can't know a shaded ray
    is 'the answer', so the verify call isn't asked — x > 4 survives."""
    async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"has_drawing": True,
                "elements": [{"type": "point", "description": "open circle at 4"},
                             {"type": "ray", "description": "bold ray to the right"}],
                "notes": "", "labeled_points": [], "unlabeled_dots": 0, "description": "number line"}

    monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
    entry = _entry(kind="number_line", plotted_elements=["open circle at x = 4", "ray to the right"],
                   labeled_points=[], answer_on_drawing="x > 4", description="Number line, x > 4 shaded.")
    ext = {"steps": [], "final_answers": [], "visual_work": [entry], "confidence": 0.9}
    await integrity_ai.verify_visual_work(
        ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
    )
    v = ext["visual_work"][0]
    # A number line isn't count-comparable (first read: circle + ray as
    # text; crop: point + ray typed) — the first read stands, unchecked,
    # and its answer survives.
    assert v["verified"] is False and "unconfirmed" not in v
    assert v["answer_on_drawing"] == "x > 4"
    assert v["plotted_elements"] == ["open circle at x = 4", "ray to the right"]


@pytest.mark.parametrize("kind", ["number_line", "diagram"])
async def test_tick_or_vertex_labels_never_raise_a_points_doubt(
    monkeypatch: pytest.MonkeyPatch, kind: str,
) -> None:
    """drawing-eval case d (recorded): the first read listed the tick "4"
    as a labeled point, the crop listed none. Points are only compared on
    a coordinate graph — elsewhere the first read stands, unchecked."""
    async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"has_drawing": True,
                "elements": [{"type": "point", "description": "open circle at 4"},
                             {"type": "ray", "description": "bold ray to the right"}],
                "notes": "", "labeled_points": [], "unlabeled_dots": 0, "description": "number line"}

    monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
    entry = _entry(kind=kind, plotted_elements=["open circle at x = 4", "ray to the right"],
                   labeled_points=["4"], answer_on_drawing="x > 4")
    ext = {"steps": [], "final_answers": [], "visual_work": [entry], "confidence": 0.9}
    await integrity_ai.verify_visual_work(
        ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
    )
    v = ext["visual_work"][0]
    assert v["verified"] is False and "unconfirmed" not in v
    assert v["labeled_points"] == ["4"] and v["answer_on_drawing"] == "x > 4"


def test_verify_schema_has_typed_elements_and_no_answer() -> None:
    from api.core.llm_schemas import VISUAL_WORK_VERIFY_SCHEMA

    props = VISUAL_WORK_VERIFY_SCHEMA["input_schema"]["properties"]
    assert "answer_on_drawing" not in props and "plotted_elements" not in props
    assert props["elements"]["items"]["properties"]["type"]["enum"][:2] == ["line", "curve"]
    assert "notes" in props


async def test_verify_keeps_the_first_reads_marks_when_they_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"has_drawing": True, "elements": _lines(["a", "b"]), "notes": "", "labeled_points": ["(2,3)"],
                "unlabeled_dots": 0, "description": "two lines"}

    monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
    ext = {"steps": [], "final_answers": [], "visual_work": [_entry()], "confidence": 0.9}
    await integrity_ai.verify_visual_work(
        ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
    )
    v = ext["visual_work"][0]
    assert v["labeled_points"] == ["(2, 3)"] and v["answer_on_drawing"] == "(2, 3)"


class TestComparableOnlyOnTheSameBasis:
    """Cold-review P1: the first read's elements are untyped text, the
    crop's are typed. Comparing a count of one against the other replaced
    real inventories with empty ones. Only a graph whose crop shows lines
    (and at most marked points) is compared; nothing else is rewritten."""

    async def _verify(self, monkeypatch: pytest.MonkeyPatch, entry: dict[str, Any],
                      elements: list[dict[str, str]], points: list[str]) -> dict[str, Any]:
        async def fake_vision(*args: Any, **kwargs: Any) -> dict[str, Any]:
            return {"has_drawing": True, "elements": elements, "notes": "",
                    "labeled_points": points, "unlabeled_dots": 0, "description": "crop"}

        monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
        ext = {"steps": [], "final_answers": [], "visual_work": [entry], "confidence": 0.9}
        await integrity_ai.verify_visual_work(
            ext, [{"data": _page(), "media_type": "image/jpeg"}], flagged_positions=_FLAGGED,
        )
        return ext["visual_work"][0]

    async def test_plotted_points_are_never_emptied(self, monkeypatch: pytest.MonkeyPatch) -> None:
        entry = _entry(plotted_elements=["point A(1, 2)", "point B(3, -1)"],
                       labeled_points=["A(1, 2)", "B(3, -1)"], answer_on_drawing=None)
        v = await self._verify(monkeypatch, entry, [
            {"type": "point", "description": "dot"}, {"type": "point", "description": "dot"},
        ], ["(1,2)", "(3,-1)"])
        assert v["plotted_elements"] == ["point A(1, 2)", "point B(3, -1)"]
        assert v["verified"] is False and "unconfirmed" not in v  # labels A(1,2) == (1,2)

    async def test_shading_is_never_dropped(self, monkeypatch: pytest.MonkeyPatch) -> None:
        entry = _entry(plotted_elements=["dashed line y = 2x + 1", "shading below the line"],
                       labeled_points=[], answer_on_drawing="y < 2x + 1")
        v = await self._verify(monkeypatch, entry, [
            {"type": "line", "description": "dashed line"},
            {"type": "shaded_region", "description": "below"},
        ], [])
        assert v["plotted_elements"] == ["dashed line y = 2x + 1", "shading below the line"]
        assert v["verified"] is False and v["answer_on_drawing"] == "y < 2x + 1"

    async def test_a_triangle_is_not_three_segments_vs_one(self, monkeypatch: pytest.MonkeyPatch) -> None:
        entry = _entry(kind="diagram", plotted_elements=["triangle ABC"], labeled_points=[],
                       answer_on_drawing=None)
        v = await self._verify(monkeypatch, entry, [
            {"type": "segment", "description": "AB"}, {"type": "segment", "description": "BC"},
            {"type": "segment", "description": "CA"},
        ], [])
        assert v["plotted_elements"] == ["triangle ABC"] and v["verified"] is False

    async def test_a_marked_intersection_does_not_break_the_line_count(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        entry = _entry(plotted_elements=["line rising", "line falling", "circled dot at the intersection"])
        v = await self._verify(monkeypatch, entry, [
            {"type": "line", "description": "rising"}, {"type": "line", "description": "falling"},
            {"type": "point", "description": "circled"},
        ], ["(2,3)"])
        assert v["verified"] is True and v["verified_scope"] == "count"
        assert v["plotted_elements"] == ["line rising", "line falling", "circled dot at the intersection"]


def test_same_marks_ignores_labels_and_spacing() -> None:
    assert integrity_ai._same_marks(["A(1, 2)", "B (3,-1)"], ["(3,-1)", "(1,2)"])
    assert not integrity_ai._same_marks(["(2, 3)"], ["(1, 3)"])
    assert not integrity_ai._same_marks(["(2, 3)"], [])
