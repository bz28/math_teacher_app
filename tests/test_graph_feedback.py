"""The note a student reads under a graph problem is written from both parts
(`graph_feedback`), after the drawing is marked.

Pinned from the Nov 2026 graph eval: the grader's note, written before the
drawing was marked, said "Correct — nice job" beside 10% on 8 of 10 graph
problems."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from api.core import grading_ai, graph_feedback
from api.core.graph_feedback import fallback_feedback, needs_note, write_graph_note
from api.core.graph_grading import ProblemGraphCheck


def _entry(percent: float, *verdicts: str, feedback: str = "Correct — nice job.") -> dict[str, Any]:
    return {
        "problem_id": "p1",
        "percent": percent,
        "feedback": feedback,
        "graph": {"points": 8, "earned": 0, "items": [
            {"n": n, "text": f"Feature {n}", "points": 2, "verdict": v, "seen": f"seen {n}"}
            for n, v in enumerate(verdicts, 1)
        ]},
    }


class Reply:
    def __init__(self, out: dict[str, Any] | Exception) -> None:
        self.out, self.calls = out, []  # type: ignore[var-annotated]

    async def __call__(self, system: str, user: str, mode: Any, **kw: Any) -> dict[str, Any]:
        self.calls.append({"system": system, "user": user, "mode": mode, **kw})
        if isinstance(self.out, Exception):
            raise self.out
        return self.out


def test_a_full_marks_problem_keeps_the_graders_note() -> None:
    assert not needs_note(_entry(100, "yes", "yes"))
    assert needs_note(_entry(40, "yes", "no"))
    # Unclear waits on the teacher: the note must not call it right either.
    assert needs_note(_entry(100, "yes", "unclear"))


async def test_the_note_is_written_from_both_parts(monkeypatch: pytest.MonkeyPatch) -> None:
    reply = Reply({"feedback": "Your answer is right, but your line should cross at -1."})
    monkeypatch.setattr(graph_feedback, "call_claude_json", reply)
    note = await write_graph_note("Graph it.", "(2, 3)", _entry(40, "yes", "no"), "Correct — nice job.",
                                  drawing="found")
    assert note == "Your answer is right, but your line should cross at -1."
    user = reply.calls[0]["user"]
    assert "Score on this problem: 40%" in user
    assert "- no: Feature 2 (seen: seen 2)" in user and "Correct — nice job." in user
    assert "Drawing found: yes" in user


async def test_a_failed_note_falls_back_to_one_that_names_the_drawings_misses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(graph_feedback, "call_claude_json", Reply(RuntimeError("down")))
    note = await write_graph_note("Graph it.", "(2, 3)", _entry(40, "yes", "no"), "Correct — nice job.",
                                  drawing="found")
    assert note == fallback_feedback("Correct — nice job.", _entry(40, "yes", "no")["graph"]["items"])
    assert note.startswith("Your written work: Correct") and "On your drawing, check: Feature 2." in note


async def test_grading_puts_the_new_note_on_the_problem(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake(question: str, answer: str, entry: dict[str, Any], work: str | None, **kw: Any) -> str:
        assert kw["drawing"] == "none"  # both looks found nothing
        return f"note for {entry['percent']:.0f}% after: {work}"

    monkeypatch.setattr(graph_feedback, "write_graph_note", fake)
    combined = [_entry(10, "no", "no"), {**_entry(100, "yes", "yes"), "problem_id": "p2"}]
    by_bid = {"p1": {"feedback": "Correct — nice job."}, "p2": {"feedback": "Great work."}}
    problems = [{"bank_item_id": "p1", "question": "q", "final_answer": "a"},
                {"bank_item_id": "p2", "question": "q", "final_answer": "a"}]
    checks = {"p1": ProblemGraphCheck("page", "not_found", [], note="not_drawn")}
    await grading_ai._rewrite_graph_notes(combined, by_bid, problems, checks, None, uuid.uuid4())
    assert by_bid["p1"]["feedback"] == "note for 10% after: Correct — nice job."
    assert by_bid["p2"]["feedback"] == "Great work."  # full marks: untouched


@pytest.mark.parametrize(("check", "state"), [
    (ProblemGraphCheck("tight", "whole", []), "found"),
    (ProblemGraphCheck("page", "not_found", [], note="not_drawn"), "none"),
    (None, "none"),
    (ProblemGraphCheck("none", "not_found", [], note="failed"), "unchecked"),
    (ProblemGraphCheck("page", "not_found", []), "unchecked"),
])
def test_the_note_is_told_whether_the_drawing_was_found_missing_or_unchecked(check: Any, state: str) -> None:
    # A failed check is not "Drawing found: yes" (round 1 review).
    assert grading_ai._drawing_state(check) == state


async def test_an_unchecked_drawing_is_never_called_missing_or_right(monkeypatch: pytest.MonkeyPatch) -> None:
    reply = Reply({"feedback": "n"})
    monkeypatch.setattr(graph_feedback, "call_claude_json", reply)
    await write_graph_note("q", "a", _entry(100, "unclear"), "w", drawing="unchecked")
    assert "Drawing found: couldn't be checked; the teacher will look at it" in reply.calls[0]["user"]


def test_the_fallback_note_says_what_happened_to_the_drawing() -> None:
    items = _entry(10, "no", "no")["graph"]["items"]
    none = fallback_feedback("Right answer.", items, "none")
    assert "asked for a drawing, and none was found" in none and "On your drawing" not in none
    assert "teacher will look at your drawing" in fallback_feedback(None, items, "unchecked")
