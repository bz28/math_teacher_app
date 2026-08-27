"""Unit tests for the question bank chat orchestrator helpers.

These cover the deterministic, side-effect-free pieces:
- _strip_internal_fields: chat history → Claude-friendly role/content pairs
- _build_user_context: live state serialization for the prompt

The actual chat_with_bank_item function is integration-shaped (DB +
Claude) so we don't unit-test it here — the helpers are where the
state-machine logic lives that we want to lock down.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

import api.core.assignment_generation as assignment_generation
import api.core.question_bank_chat as qbc
from api.core.question_bank_chat import (
    _build_user_context,
    _strip_internal_fields,
    chat_with_bank_item,
)


class TestStripInternalFields:
    def test_teacher_message_passthrough(self) -> None:
        msgs = [{"role": "teacher", "text": "make it harder", "ts": "2026-04-07T00:00:00"}]
        out = _strip_internal_fields(msgs)
        assert out == [{"role": "user", "content": "make it harder"}]

    def test_ai_message_no_proposal(self) -> None:
        msgs = [{"role": "ai", "text": "Sure, I made it harder."}]
        out = _strip_internal_fields(msgs)
        assert out == [{"role": "assistant", "content": "Sure, I made it harder."}]

    def test_ai_message_with_pending_proposal_inlines_marker(self) -> None:
        msgs = [{
            "role": "ai",
            "text": "Here's a harder version.",
            "proposal": {"question": "x² + 100x + 99 = 0", "solution_steps": None, "final_answer": None},
        }]
        out = _strip_internal_fields(msgs)
        assert out[0]["role"] == "assistant"
        assert "Here's a harder version." in out[0]["content"]
        assert "[Proposal pending review.]" in out[0]["content"]

    def test_ai_message_with_accepted_proposal_inlines_marker(self) -> None:
        msgs = [{
            "role": "ai",
            "text": "Here's a harder version.",
            "proposal": {"question": "...", "solution_steps": None, "final_answer": None},
            "accepted": True,
        }]
        out = _strip_internal_fields(msgs)
        assert "[Teacher accepted this proposal.]" in out[0]["content"]
        assert "[Proposal pending review.]" not in out[0]["content"]

    def test_ai_message_with_discarded_proposal_inlines_marker(self) -> None:
        msgs = [{
            "role": "ai",
            "text": "Here's a harder version.",
            "proposal": {"question": "...", "solution_steps": None, "final_answer": None},
            "discarded": True,
        }]
        out = _strip_internal_fields(msgs)
        assert "[Teacher discarded this proposal.]" in out[0]["content"]

    def test_full_conversation_alternates_roles(self) -> None:
        proposal = {"question": "...", "solution_steps": None, "final_answer": None}
        msgs = [
            {"role": "teacher", "text": "harder"},
            {"role": "ai", "text": "Done.", "proposal": proposal, "accepted": True},
            {"role": "teacher", "text": "now smaller numbers"},
            {"role": "ai", "text": "Here you go.", "proposal": proposal},
        ]
        out = _strip_internal_fields(msgs)
        assert [m["role"] for m in out] == ["user", "assistant", "user", "assistant"]
        assert "accepted" in out[1]["content"]
        assert "pending" in out[3]["content"]


class TestBuildUserContext:
    def _make_item(self, **overrides: object) -> object:
        item = MagicMock()
        item.question = "Solve x² + 5x + 6 = 0"
        item.solution_steps = [
            {"title": "Factor", "description": "(x+2)(x+3)"},
            {"title": "Solve", "description": "x = -2 or x = -3"},
        ]
        item.final_answer = "x = -2 or x = -3"
        item.generation_prompt = None
        for k, v in overrides.items():
            setattr(item, k, v)
        return item

    def test_minimal_context(self) -> None:
        item = self._make_item(solution_steps=None, final_answer=None, generation_prompt=None)
        ctx = _build_user_context(item, "Unit 5", "Algebra 1")
        assert "Course: Algebra 1" in ctx
        assert "Topic: Unit 5" in ctx
        assert "Current question:\nSolve x² + 5x + 6 = 0" in ctx
        assert "Current solution" not in ctx
        assert "Current final answer" not in ctx

    def test_full_context_includes_solution_and_answer(self) -> None:
        item = self._make_item()
        ctx = _build_user_context(item, "Unit 5", "Algebra 1")
        assert "Current solution:" in ctx
        assert "1. Factor: (x+2)(x+3)" in ctx
        assert "2. Solve: x = -2 or x = -3" in ctx
        assert "Current final answer: x = -2 or x = -3" in ctx

    def test_includes_generation_constraint_when_set(self) -> None:
        item = self._make_item(generation_prompt="only word problems")
        ctx = _build_user_context(item, "Unit 5", "Algebra 1")
        assert "Original generation constraint: only word problems" in ctx


class TestQuestionRewriteReSolve:
    """When a workshop proposal rewrites the QUESTION, the chat's inline
    solution can silently disagree with it (it may fudge a value to land a
    rounder answer). The fix re-solves the new question with the same
    decomposition path generation uses and takes the answer from the solver,
    not from the chat. These lock that behavior down."""

    def _item(self) -> MagicMock:
        item = MagicMock()
        item.chat_messages = []
        item.source_doc_ids = []
        item.unit_id = None
        item.course_id = uuid.uuid4()
        item.question = "Old tangent-secant question with an ugly answer."
        item.solution_steps = [{"title": "Solve", "description": "x = 46/3"}]
        item.final_answer = "$386/3°$"
        item.generation_prompt = None
        return item

    def _course(self) -> MagicMock:
        course = MagicMock()
        course.subject = "math"
        course.name = "Accelerated Geometry"
        return course

    def _db(self) -> MagicMock:
        db = MagicMock()
        db.commit = AsyncMock()
        return db

    async def test_question_rewrite_takes_answer_from_solver(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        new_q = "arcs (8x+6) and (4x-2), exterior angle 47, find arc TB."
        # Chat proposes a rewrite with a FUDGED inline answer (the bug).
        monkeypatch.setattr(qbc, "fetch_source_documents", AsyncMock(return_value=[]))
        monkeypatch.setattr(
            qbc,
            "call_claude_json",
            AsyncMock(
                return_value={
                    "reply": "I rewrote it: x = 7 and arc TB = 118.",
                    "proposal": {
                        "question": new_q,
                        "final_answer": "$166°$",
                        "solution_steps": [
                            {"title": "Fudge", "description": "use x=20 -> 166"}
                        ],
                    },
                }
            ),
        )
        # Solver returns the CORRECT answer for that question.
        solver = AsyncMock(
            return_value=[
                {
                    "question_text": new_q,
                    "steps": [{"title": "Solve", "description": "2x+4=47 -> x=21.5"}],
                    "final_answer": "$178°$",
                }
            ]
        )
        monkeypatch.setattr(assignment_generation, "generate_solutions", solver)

        ai_msg = await chat_with_bank_item(
            self._db(), self._item(), self._course(),
            teacher_message="make the numbers clean", user_id=uuid.uuid4(),
        )

        proposal = ai_msg["proposal"]
        # Answer comes from the solver, not the chat's fudged 166.
        assert proposal["final_answer"] == "$178°$"
        assert "166" not in proposal["final_answer"]
        # Steps come from the solver too.
        assert proposal["solution_steps"][0]["description"] == "2x+4=47 -> x=21.5"
        # The solver was actually invoked on the NEW question.
        solver.assert_awaited_once()
        assert solver.await_args.args[0] == [{"text": new_q}]
        # The chat's contradictory prose ("118") is replaced with a neutral note.
        assert "118" not in ai_msg["text"]
        assert "re-derived independently" in ai_msg["text"]

    async def test_solution_only_edit_does_not_re_solve(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Teacher asks to tweak only the solution wording; question unchanged.
        # We must NOT override their edit with a fresh solve.
        monkeypatch.setattr(qbc, "fetch_source_documents", AsyncMock(return_value=[]))
        monkeypatch.setattr(
            qbc,
            "call_claude_json",
            AsyncMock(
                return_value={
                    "reply": "Made step 1 more concise.",
                    "proposal": {
                        "question": None,
                        "final_answer": None,
                        "solution_steps": [
                            {"title": "Solve", "description": "concise version"}
                        ],
                    },
                }
            ),
        )
        solver = AsyncMock(return_value=[])
        monkeypatch.setattr(assignment_generation, "generate_solutions", solver)

        ai_msg = await chat_with_bank_item(
            self._db(), self._item(), self._course(),
            teacher_message="make step 1 concise", user_id=uuid.uuid4(),
        )

        solver.assert_not_awaited()
        assert ai_msg["proposal"]["solution_steps"][0]["description"] == "concise version"
        # Reply is left as-is (no question rewrite happened).
        assert ai_msg["text"] == "Made step 1 more concise."
