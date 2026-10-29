"""The graph grading pipeline's code around the models: which problems get
a graph part, where the drawing check looks, and how the two parts add
up. The drawing check and the grader are stubbed; their judgment is the
eval's to measure."""

from __future__ import annotations

import base64
import io
from typing import Any

import pypdfium2 as pdfium
import pytest
from PIL import Image, ImageDraw

from api.core import graph_grading
from api.core.drawing_check import ChecklistItem, DrawingCheck, ItemResult
from api.core.grading_ai import _build_breakdown, _build_problem_set_block, _build_system_prompt, _build_user_message
from api.core.graph_checklist import source_of, to_stored
from api.core.graph_grading import (
    GraphPart,
    ProblemGraphCheck,
    apply_graph_parts,
    check_graphs,
    check_problem_drawing,
    combine,
    graph_part,
    page_images,
    uploads_look_sideways,
)
from api.core.image_utils import pdf_pages_as_images
from api.models.question_bank import QuestionBankItem

pytestmark = pytest.mark.anyio

ITEMS = [ChecklistItem("Line through (0, 1) and (2, 5)", 2), ChecklistItem("Both axes labeled", 1)]
PART = GraphPart(items=ITEMS, points=5)
BOX = {"x0": 0.1, "y0": 0.1, "x1": 0.5, "y1": 0.5}


def _jpeg(color: tuple[int, int, int] = (250, 250, 250)) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (400, 500), color).save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def _pdf(pages: int) -> str:
    pdf = pdfium.PdfDocument.new()
    for _ in range(pages):
        pdf.new_page(612, 792)
    buf = io.BytesIO()
    pdf.save(buf)
    pdf.close()
    return base64.b64encode(buf.getvalue()).decode()


def _item(**kw: Any) -> QuestionBankItem:
    item = QuestionBankItem(
        question="Graph y = 2x + 1.",
        final_answer="y = 2x + 1",
        requires_drawing=True,
        status="approved",
    )
    item.graph_checklist = to_stored(ITEMS, 5, source=source_of(item), teacher_edited=False)
    for k, v in kw.items():
        setattr(item, k, v)
    return item


class Checks:
    """Stands in for check_drawing: records each look, answers from a queue."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.replies: list[DrawingCheck | Exception] = []

    def queue(self, *replies: DrawingCheck | Exception) -> None:
        self.replies.extend(replies)

    async def __call__(self, page: str, media_type: str, bbox: Any, items: Any, **kw: Any) -> DrawingCheck:
        self.calls.append({"page": page, "media_type": media_type, "bbox": bbox, **kw})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


@pytest.fixture
def checks(monkeypatch: pytest.MonkeyPatch) -> Checks:
    fake = Checks()
    monkeypatch.setattr(graph_grading, "check_drawing", fake)
    return fake


def _found(step: str, *verdicts: str) -> DrawingCheck:
    return DrawingCheck(step, "whole", [ItemResult(n, v, "s") for n, v in enumerate(verdicts, 1)])  # type: ignore[arg-type]


def _not_found() -> DrawingCheck:
    return DrawingCheck("page", "not_found", [ItemResult(n, "unclear", "Couldn't find the drawing.") for n in (1, 2)])


def _extraction(*, visual: list[dict[str, Any]] | None = None, step_page: int | None = 1) -> dict[str, Any]:
    steps = [{"step_num": 1, "problem_position": 1, "page_index": step_page, "latex": "y=2x+1"}]
    return {"steps": steps, "final_answers": [], "visual_work": visual or []}


def _drawn(page: int | None = 1, bbox: dict[str, Any] | None = BOX, kind: str = "graph") -> dict[str, Any]:
    return {"problem_position": 1, "kind": kind, "present": True, "page_index": page, "bbox": bbox}


# ── graph_part ─────────────────────────────────────────────────────


def test_a_current_checklist_is_the_graph_part() -> None:
    part = graph_part(_item(), 5, [])
    assert part is not None
    assert (part.graph_points, part.work_points) == (3, 2)


def test_the_graph_part_is_resized_to_the_problems_points_on_this_homework() -> None:
    part = graph_part(_item(), 10, [])
    assert part is not None and part.points == 10 and 1 <= part.work_points < 10


@pytest.mark.parametrize(
    "change",
    [
        {"requires_drawing": False},
        {"graph_checklist": None},
        {"question": "Graph y = 3x."},  # stale: written from other text
    ],
)
def test_no_graph_part_without_a_current_checklist_on_a_drawing_question(change: dict[str, Any]) -> None:
    assert graph_part(_item(**change), 5, []) is None


def test_no_graph_part_when_the_writer_read_no_drawing_asked() -> None:
    item = _item()
    item.graph_checklist = to_stored([], 5, source=source_of(item), teacher_edited=False, asks_for_drawing=False)
    assert graph_part(item, 5, []) is None


def test_no_graph_part_on_a_problem_with_no_room_for_one() -> None:
    assert graph_part(_item(), 1, []) is None


def test_the_key_changes_with_the_checklist_or_the_points() -> None:
    assert PART.key == GraphPart(list(ITEMS), 5).key
    assert PART.key != GraphPart(ITEMS, 6).key
    assert PART.key != GraphPart([ITEMS[0], ChecklistItem("Both axes labeled", 2)], 5).key


# ── pages ──────────────────────────────────────────────────────────


def test_a_pdf_renders_one_image_per_page() -> None:
    pages = pdf_pages_as_images(_pdf(3))
    assert len(pages) == 3
    img = Image.open(io.BytesIO(base64.b64decode(pages[0])))
    assert img.format == "JPEG" and max(img.size) == 2400


def test_an_unreadable_pdf_has_no_pages() -> None:
    assert pdf_pages_as_images(base64.b64encode(b"not a pdf").decode()) == []


def test_page_images_follow_the_readers_file_numbering() -> None:
    photo = _jpeg()
    pages = page_images(
        [
            {"data": f"data:image/jpeg;base64,{photo}", "media_type": "image/jpeg"},
            {"data": _pdf(2), "media_type": "application/pdf"},
            {"data": "eA==", "media_type": "text/plain"},
        ]
    )
    assert [len(p) for p in pages] == [1, 2, 0]
    assert pages[0] == [(photo, "image/jpeg")]
    assert {mt for _, mt in pages[1]} == {"image/jpeg"}


# ── check_problem_drawing ──────────────────────────────────────────


async def test_a_blank_problem_is_not_checked(checks: Checks) -> None:
    blank = {"steps": [], "final_answers": [], "visual_work": [{"problem_position": 1, "present": False}]}
    assert await check_problem_drawing(blank, [[(_jpeg(), "image/jpeg")]], 1, PART) is None
    assert checks.calls == []


async def test_a_located_drawing_is_cropped_on_its_page(checks: Checks) -> None:
    p1, p2 = _jpeg((255, 255, 255)), _jpeg((0, 0, 0))
    checks.queue(_found("tight", "yes", "no"))
    pages = [[(p1, "image/jpeg")], [(p2, "image/jpeg")]]
    r = await check_problem_drawing(_extraction(visual=[_drawn(page=2)]), pages, 1, PART)
    assert r is not None and (r.step, [i.verdict for i in r.items]) == ("tight", ["yes", "no"])
    assert [(c["page"], c["bbox"]) for c in checks.calls] == [(p2, BOX)]


async def test_a_located_drawing_not_on_its_page_is_hunted_on_the_others(checks: Checks) -> None:
    p1, p2 = _jpeg((255, 255, 255)), _jpeg((0, 0, 0))
    checks.queue(_not_found(), _found("page", "yes", "no"))
    pages = [[(p1, "image/jpeg")], [(p2, "image/jpeg")]]
    r = await check_problem_drawing(_extraction(visual=[_drawn(page=2)]), pages, 1, PART)
    assert [(c["page"], c["bbox"]) for c in checks.calls] == [(p2, BOX), (p1, None)]
    assert r is not None and [i.verdict for i in r.items] == ["yes", "no"]


async def test_a_drawing_without_a_page_on_a_one_page_upload_is_on_that_page(checks: Checks) -> None:
    checks.queue(_found("tight", "yes", "yes"))
    page = _jpeg()
    await check_problem_drawing(_extraction(visual=[_drawn(page=None)]), [[(page, "image/jpeg")]], 1, PART)
    assert checks.calls[0]["bbox"] == BOX


async def test_a_graph_is_looked_for_before_a_table_of_values(checks: Checks) -> None:
    table = {**_drawn(), "kind": "table", "bbox": {"x0": 0.6, "y0": 0.6, "x1": 0.9, "y1": 0.9}}
    checks.queue(_found("tight", "yes", "yes"))
    await check_problem_drawing(_extraction(visual=[table, _drawn()]), [[(_jpeg(), "image/jpeg")]], 1, PART)
    assert checks.calls[0]["bbox"] == BOX


async def test_without_a_box_the_whole_page_the_work_is_on_is_looked_at_first(checks: Checks) -> None:
    p1, p2 = _jpeg((255, 255, 255)), _jpeg((0, 0, 0))
    checks.queue(_found("page", "yes", "yes"))
    await check_problem_drawing(
        _extraction(visual=[_drawn(page=None, bbox=None)], step_page=2),
        [[(p1, "image/jpeg")], [(p2, "image/jpeg")]],
        1,
        PART,
    )
    assert [(c["page"], c["bbox"]) for c in checks.calls] == [(p2, None)]


async def test_the_hunt_moves_on_to_other_pages_until_one_shows_the_drawing(checks: Checks) -> None:
    p1, p2 = _jpeg((255, 255, 255)), _jpeg((0, 0, 0))
    checks.queue(_not_found(), _found("page", "no", "yes"))
    r = await check_problem_drawing(_extraction(step_page=2), [[(p1, "image/jpeg")], [(p2, "image/jpeg")]], 1, PART)
    assert [c["page"] for c in checks.calls] == [p2, p1]
    assert r is not None and [i.verdict for i in r.items] == ["no", "yes"]


async def test_a_drawing_on_a_multi_page_pdf_is_hunted_page_by_page(checks: Checks) -> None:
    pages = page_images([{"data": _pdf(2), "media_type": "application/pdf"}])
    checks.queue(_not_found(), _found("page", "yes", "yes"))
    r = await check_problem_drawing(_extraction(visual=[_drawn()]), pages, 1, PART)
    assert [(c["page"], c["bbox"]) for c in checks.calls] == [(pages[0][0][0], None), (pages[0][1][0], None)]
    assert r is not None and r.step == "page"


async def test_a_drawing_on_a_one_page_pdf_is_cropped(checks: Checks) -> None:
    pages = page_images([{"data": _pdf(1), "media_type": "application/pdf"}])
    checks.queue(_found("tight", "yes", "yes"))
    await check_problem_drawing(_extraction(visual=[_drawn()]), pages, 1, PART)
    assert checks.calls[0]["bbox"] == BOX and checks.calls[0]["media_type"] == "image/jpeg"


async def test_the_hunt_is_capped(checks: Checks) -> None:
    pages = [[(_jpeg(), "image/jpeg")] for _ in range(9)]
    checks.queue(*[_not_found() for _ in range(9)])
    r = await check_problem_drawing(_extraction(visual=[_drawn(bbox=None)]), pages, 1, PART)
    assert len(checks.calls) == graph_grading._MAX_PAGE_LOOKS
    assert r is not None and [i.verdict for i in r.items] == ["unclear", "unclear"]


async def test_a_drawing_no_look_can_find_is_unclear(checks: Checks) -> None:
    checks.queue(_not_found())
    r = await check_problem_drawing(_extraction(visual=[_drawn(bbox=None)]), [[(_jpeg(), "image/jpeg")]], 1, PART)
    assert r is not None and r.note is None
    assert [(i.verdict, i.seen) for i in r.items] == [("unclear", "Couldn't find the drawing.")] * 2


async def test_no_drawing_when_the_reader_and_the_look_agree_there_is_none(checks: Checks) -> None:
    checks.queue(_not_found())
    missing = {"problem_position": 1, "kind": "graph", "present": False}
    r = await check_problem_drawing(_extraction(visual=[missing]), [[(_jpeg(), "image/jpeg")]], 1, PART)
    assert r is not None and r.note == "not_drawn"
    assert [i.verdict for i in r.items] == ["no", "no"]


async def test_an_upload_with_no_images_is_unclear_without_a_look(checks: Checks) -> None:
    r = await check_problem_drawing(_extraction(visual=[_drawn()]), [[]], 1, PART)
    assert checks.calls == [] and r is not None
    assert (r.step, [i.verdict for i in r.items]) == ("none", ["unclear", "unclear"])


async def test_a_check_that_fails_is_unclear_for_the_teacher(checks: Checks) -> None:
    checks.queue(RuntimeError("malformed twice"))
    r = await check_problem_drawing(_extraction(visual=[_drawn()]), [[(_jpeg(), "image/jpeg")]], 1, PART)
    assert r is not None and r.note == "failed"
    assert [(i.verdict, i.seen) for i in r.items] == [("unclear", "Couldn't check the graph.")] * 2


async def test_check_graphs_checks_only_problems_with_a_graph_part(checks: Checks) -> None:
    checks.queue(_found("tight", "yes", "yes"))
    problems = [
        {"position": 1, "bank_item_id": "a", "graph_part": PART},
        {"position": 2, "bank_item_id": "b"},
    ]
    files = [{"data": _jpeg(), "media_type": "image/jpeg"}]
    out = await check_graphs(_extraction(visual=[_drawn()]), files, problems)
    assert list(out) == ["a"] and len(checks.calls) == 1
    assert out["a"] is not None and out["a"].stored(PART)["checklist_key"] == PART.key


def _lined_page(sideways: bool) -> str:
    """A page of handwriting-like rows of ink; turned on its side when
    `sideways`."""
    img = Image.new("RGB", (800, 1000), (250, 250, 250))
    draw = ImageDraw.Draw(img)
    for y in range(60, 960, 40):
        for x in range(60, 740, 24):
            draw.line([(x, y), (x + 14, y)], fill=(20, 20, 20), width=4)
    if sideways:
        img = img.rotate(90, expand=True)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def test_an_upload_is_sideways_when_any_page_is() -> None:
    upright, sideways = _lined_page(False), _lined_page(True)
    assert not uploads_look_sideways([[(upright, "image/jpeg")], [(upright, "image/jpeg")]])
    assert uploads_look_sideways([[(upright, "image/jpeg")], [(sideways, "image/jpeg")]])


async def test_on_a_sideways_upload_a_no_is_unclear_and_a_yes_stands(checks: Checks) -> None:
    checks.queue(_found("tight", "yes", "no"))
    r = await check_problem_drawing(
        _extraction(visual=[_drawn()]), [[(_jpeg(), "image/jpeg")]], 1, PART, sideways=True,
    )
    assert r is not None and [i.verdict for i in r.items] == ["yes", "unclear"]
    assert "looks sideways" in r.items[1].seen and r.items[0].seen == "s"


async def test_on_a_sideways_upload_an_agreed_missing_drawing_is_still_no(checks: Checks) -> None:
    checks.queue(_not_found())
    missing = {"problem_position": 1, "kind": "graph", "present": False}
    r = await check_problem_drawing(
        _extraction(visual=[missing]), [[(_jpeg(), "image/jpeg")]], 1, PART, sideways=True,
    )
    assert r is not None and r.note == "not_drawn" and [i.verdict for i in r.items] == ["no", "no"]


async def test_check_graphs_doubts_the_noes_of_a_sideways_upload(checks: Checks) -> None:
    checks.queue(_found("tight", "no", "yes"))
    problems = [{"position": 1, "bank_item_id": "a", "graph_part": PART}]
    files = [{"data": _lined_page(True), "media_type": "image/jpeg"}]
    out = await check_graphs(_extraction(visual=[_drawn()]), files, problems)
    assert out["a"] is not None and [i.verdict for i in out["a"].items] == ["unclear", "yes"]


# ── combine ────────────────────────────────────────────────────────


def _work(
    status: str,
    percent: float,
    *deductions: dict[str, Any],
    rules: dict[str, int | None] | None = None,
    work_points: int = 2,
) -> dict[str, Any]:
    """The grader's entry for the work, charged in the work part's points."""
    grade = {
        "problem_position": 1,
        "score_status": status,
        "percent": percent,
        "deductions": list(deductions),
        "confidence": 0.9,
        "student_feedback": "f",
    }
    breakdown, _ = _build_breakdown([grade], {1: "p"}, rules=rules or {}, points={"p": work_points})
    return breakdown[0]


def _check(*verdicts: str) -> ProblemGraphCheck:
    return ProblemGraphCheck("tight", "whole", [ItemResult(n, v, "s") for n, v in enumerate(verdicts, 1)])  # type: ignore[arg-type]


def _ledger_adds_up(entry: dict[str, Any]) -> bool:
    return bool(abs(100 - sum(d["points_off"] for d in entry["deductions"]) - entry["percent"]) < 1e-9)


def test_everything_right_is_full_credit() -> None:
    out = combine(_work("full", 100), PART, _check("yes", "yes"))
    assert (out["score_status"], out["percent"], out["deductions"], out["needs_check"]) == ("full", 100, [], False)


def test_a_missing_graph_feature_takes_off_its_points_as_its_own_line() -> None:
    out = combine(_work("full", 100), PART, _check("no", "yes"))
    assert out["percent"] == pytest.approx(60)
    assert out["deductions"] == [
        {
            "points_off": pytest.approx(40),
            "reason": "Graph: Line through (0, 1) and (2, 5)",
            "step_ref": None,
            "rule_id": None,
            "source": "graph_checklist",
        }
    ]


def test_work_deductions_are_resized_from_the_work_part_to_the_whole_problem() -> None:
    work = _work("partial", 50, {"points_off": 50, "reason": "sign error", "step_ref": 1, "rule_id": None})
    out = combine(work, PART, _check("yes", "yes"))
    assert out["percent"] == pytest.approx(80)  # 3 graph + 1 of 2 work
    assert [(d["reason"], d["points_off"]) for d in out["deductions"]] == [("sign error", pytest.approx(20))]
    assert _ledger_adds_up(out)


def test_an_unclear_item_keeps_its_points_and_asks_the_teacher() -> None:
    out = combine(_work("full", 100), PART, _check("unclear", "yes"))
    assert out["percent"] == 100 and out["needs_check"] is True
    assert out["graph"]["items"][0]["verdict"] == "unclear"


def test_a_blank_problem_earns_nothing_and_the_ledger_still_adds_up() -> None:
    out = combine(_work("zero", 0), PART, None)
    assert (out["score_status"], out["percent"]) == ("zero", 0)
    assert _ledger_adds_up(out) and out["needs_check"] is False


def test_a_grader_deduction_citing_a_rule_the_checklist_owns_is_given_back() -> None:
    part = GraphPart([ChecklistItem("Axes labeled", 1, rule_id="r1"), ChecklistItem("Line drawn", 2)], 5)
    work = _work(
        "partial", 50, {"points_off": 50, "reason": "axes", "step_ref": None, "rule_id": "r1"}, rules={"r1": 1}
    )
    out = combine(work, part, _check("no", "yes"))
    # The checklist charges r1 once (1 point); the work part is whole again.
    assert out["percent"] == pytest.approx(80)
    assert [(d["source"], d["rule_id"]) for d in out["deductions"]] == [("graph_checklist", "r1")]
    assert _ledger_adds_up(out)


def test_mixed_verdicts_and_work_add_up() -> None:
    work = _work("partial", 75, {"points_off": 25, "reason": "slip", "step_ref": None, "rule_id": None}, work_points=6)
    part = GraphPart([ChecklistItem("A", 2), ChecklistItem("B", 1), ChecklistItem("C", 1)], 10)
    out = combine(work, part, _check("yes", "no", "unclear"))
    assert out["percent"] == pytest.approx((2 + 1 + 4.5) * 10)
    assert out["needs_check"] is True and _ledger_adds_up(out)


def test_apply_graph_parts_scores_over_the_full_points() -> None:
    graph = _work("full", 100)
    other = {
        **_work("partial", 50, {"points_off": 50, "reason": "x", "step_ref": None, "rule_id": None}, work_points=5),
        "problem_id": "q",
    }
    out, score = apply_graph_parts([graph, other], {"p": PART}, {"p": _check("no", "yes")}, {"p": 5, "q": 5})
    assert out[1] is other
    assert score == pytest.approx((60 + 50) / 2)


# ── the grader's work-only mode ────────────────────────────────────


PROBLEM = {
    "position": 1,
    "question": "Graph y = 2x + 1.",
    "final_answer": "y = 2x + 1",
    "requires_drawing": True,
    "points": 5,
}


def test_without_a_graph_part_the_prompt_is_unchanged() -> None:
    assert _build_problem_set_block([{**PROBLEM, "graph_part": None}], with_points=True) == (
        _build_problem_set_block([PROBLEM], with_points=True)
    )
    assert "Requires a drawing: yes" in _build_problem_set_block([PROBLEM])


def test_a_graph_part_grades_the_work_alone_worth_its_points() -> None:
    block = _build_problem_set_block([{**PROBLEM, "graph_part": PART}], with_points=True)
    assert "Worth: 2 points" in block and "Worth: 5 points" not in block
    assert "Requires a drawing" not in block
    assert "Drawing: checked separately" in block


def test_a_graph_part_names_the_rules_its_checklist_owns() -> None:
    part = GraphPart([ChecklistItem("Axes labeled", 1, rule_id="r1"), ChecklistItem("Line drawn", 2)], 5)
    block = _build_problem_set_block([{**PROBLEM, "graph_part": part}])
    assert "Class rules [r1] are checked with the drawing" in block


def test_only_the_problem_with_a_graph_part_changes() -> None:
    other = {**PROBLEM, "position": 2}
    with_part = _build_system_prompt(None, [{**PROBLEM, "graph_part": PART}, other])
    assert with_part.split("## Problem 2")[1] == _build_system_prompt(None, [PROBLEM, other]).split("## Problem 2")[1]


def test_a_graph_part_shows_the_grader_only_what_is_written_on_the_drawing() -> None:
    drawing = {
        "problem_position": 1, "kind": "graph", "present": True, "verified": True,
        "plotted_elements": ["one line rising"], "labeled_points": ["(2, 3)"],
        "answer_on_drawing": "(2, 3)", "description": "Only one line is drawn.",
    }
    extraction = {"steps": [], "final_answers": [], "visual_work": [drawing]}
    alone = _build_user_message(extraction, [{**PROBLEM, "graph_part": PART}])
    assert "(2, 3)" in alone and "checked separately" in alone
    assert "one line rising" not in alone and "Only one line" not in alone
    whole = _build_user_message(extraction, [PROBLEM])
    assert "one line rising" in whole and "Only one line" in whole
