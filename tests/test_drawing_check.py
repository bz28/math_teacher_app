"""check_drawing's code around the model: how it widens its look, and that
every item always gets exactly one verdict, "unclear" whenever the model's
answer can't be trusted. The model's judgment itself is measured by the
graph-check harness probe."""

from __future__ import annotations

import base64
import io
from typing import Any

import pytest
from PIL import Image

from api.core import drawing_check
from api.core.drawing_check import ChecklistItem, _parse_check, check_drawing

pytestmark = pytest.mark.anyio

ITEMS = [ChecklistItem("Vertical asymptote drawn at x = 2", 2), ChecklistItem("Both asymptotes labeled", 1)]
BOX = {"x0": 0.4, "y0": 0.3, "x1": 0.9, "y1": 0.7}


def _page() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (800, 1000), (250, 250, 250)).save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


class Looks:
    """Stands in for the vision call: records each look, answers from a queue."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.replies: list[dict[str, Any]] = []

    def queue(self, *replies: dict[str, Any]) -> None:
        self.replies.extend(replies)

    async def __call__(self, content: list[Any], mode: str, **kw: Any) -> dict[str, Any]:
        self.calls.append({"text": content[1]["text"], **kw})
        return self.replies.pop(0)


@pytest.fixture
def looks(monkeypatch: pytest.MonkeyPatch) -> Looks:
    fake = Looks()
    monkeypatch.setattr(drawing_check, "call_claude_vision", fake)
    return fake


def _reply(in_view: str, *verdicts: str) -> dict[str, Any]:
    return {"in_view": in_view, "items": [{"n": n, "verdict": v, "seen": "s"} for n, v in enumerate(verdicts, 1)]}


async def test_a_whole_drawing_in_the_tight_crop_settles_it(looks: Looks) -> None:
    looks.queue(_reply("whole", "yes", "no"))
    r = await check_drawing(_page(), "image/jpeg", BOX, ITEMS, problem_position=4)
    assert (r.step, [i.verdict for i in r.items]) == ("tight", ["yes", "no"])
    assert len(looks.calls) == 1


async def test_a_cut_off_drawing_gets_a_wider_look(looks: Looks) -> None:
    looks.queue(_reply("cut_off", "unclear", "unclear"), _reply("whole", "yes", "yes"))
    r = await check_drawing(_page(), "image/jpeg", BOX, ITEMS, problem_position=4)
    assert (r.step, [i.verdict for i in r.items]) == ("wide", ["yes", "yes"])


async def test_still_cut_off_when_wide_keeps_the_wide_look(looks: Looks) -> None:
    looks.queue(_reply("cut_off", "unclear", "unclear"), _reply("cut_off", "yes", "unclear"))
    r = await check_drawing(_page(), "image/jpeg", BOX, ITEMS, problem_position=4)
    assert r.step == "wide" and len(looks.calls) == 2


async def test_crops_without_the_drawing_fall_back_to_the_page(looks: Looks) -> None:
    looks.queue(_reply("not_found"), _reply("not_found"), _reply("whole", "no", "yes"))
    r = await check_drawing(_page(), "image/jpeg", BOX, ITEMS, problem_position=4)
    assert (r.step, [i.verdict for i in r.items]) == ("page", ["no", "yes"])
    assert "problem 4" in looks.calls[-1]["text"]


async def test_no_box_goes_straight_to_the_page(looks: Looks) -> None:
    looks.queue(_reply("whole", "yes", "yes"))
    r = await check_drawing(_page(), "image/jpeg", None, ITEMS, problem_position=2)
    assert r.step == "page" and len(looks.calls) == 1


async def test_a_drawing_nobody_can_find_is_left_to_the_teacher(looks: Looks) -> None:
    """Even if the model says "no" while also saying it found nothing."""
    looks.queue(_reply("not_found", "no", "no"))
    r = await check_drawing(_page(), "image/jpeg", None, ITEMS, problem_position=2)
    assert [i.verdict for i in r.items] == ["unclear", "unclear"]


async def test_the_check_never_sees_the_question_or_answer(looks: Looks) -> None:
    looks.queue(_reply("whole", "yes", "yes"))
    await check_drawing(_page(), "image/jpeg", BOX, ITEMS, problem_position=4)
    sent = looks.calls[0]
    assert sent["text"].endswith("1. Vertical asymptote drawn at x = 2\n2. Both asymptotes labeled")
    assert sent["model"] == drawing_check.MODEL_OPUS and "temperature" not in sent


async def test_a_pdf_page_is_left_to_the_teacher_without_a_call(looks: Looks) -> None:
    r = await check_drawing("JVBERi0=", "application/pdf", BOX, ITEMS, problem_position=4)
    assert r.step == "none" and [i.verdict for i in r.items] == ["unclear", "unclear"]
    assert looks.calls == []


def test_skipped_duplicated_or_off_script_items_become_unclear() -> None:
    out = {"in_view": "whole", "items": [
        {"n": 1, "verdict": "yes", "seen": "a"},
        {"n": 1, "verdict": "no", "seen": "duplicate is ignored"},
        {"n": 3, "verdict": "yes", "seen": "no such item"},
    ]}
    in_view, results = _parse_check(out, 2)
    assert in_view == "whole"
    assert [(r.n, r.verdict) for r in results] == [(1, "yes"), (2, "unclear")]
    assert _parse_check({"in_view": "maybe", "items": [{"n": 1, "verdict": "probably"}]}, 1)[1][0].verdict == "unclear"


async def test_a_malformed_answer_is_asked_once_more(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    async def flaky(content: list[Any], mode: str, **kw: Any) -> dict[str, Any]:
        calls.append(kw["call_metadata"]["attempt"])
        if len(calls) == 1:
            raise RuntimeError("Failed to parse Claude Vision response: ... an unparseable string (22 chars)")
        return _reply("whole", "yes", "yes")

    monkeypatch.setattr(drawing_check, "call_claude_vision", flaky)
    r = await check_drawing(_page(), "image/jpeg", BOX, ITEMS, problem_position=4)
    assert calls == [1, 2] and [i.verdict for i in r.items] == ["yes", "yes"]
