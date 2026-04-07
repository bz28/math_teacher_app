"""Unit tests for the question bank chat orchestrator helpers.

These cover the deterministic, side-effect-free pieces:
- _strip_internal_fields: chat history → Claude-friendly role/content pairs
- _build_user_context: live state serialization for the prompt

The actual chat_with_bank_item function is integration-shaped (DB +
Claude) so we don't unit-test it here — the helpers are where the
state-machine logic lives that we want to lock down.
"""

from unittest.mock import MagicMock

from api.core.question_bank_chat import _build_user_context, _strip_internal_fields


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
        msgs = [
            {"role": "teacher", "text": "harder"},
            {"role": "ai", "text": "Done.", "proposal": {"question": "...", "solution_steps": None, "final_answer": None}, "accepted": True},
            {"role": "teacher", "text": "now smaller numbers"},
            {"role": "ai", "text": "Here you go.", "proposal": {"question": "...", "solution_steps": None, "final_answer": None}},
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
