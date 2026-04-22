"""Unit tests for the integrity-checker agent-loop helpers.

Pipeline-with-DB tests live in test_integrity_check.py since they
need the seeded world fixture. This file exercises the pure helpers
— problem briefing, transcript-to-messages folding, tool-input
validation — so regressions in the prompt shape are caught fast.
"""

from __future__ import annotations

import json
import uuid

from api.core.integrity_ai import build_problems_briefing
from api.core.integrity_pipeline import _build_agent_messages
from api.models.integrity_check import IntegrityConversationTurn


def _turn(ordinal: int, role: str, content: str, **kw: str) -> IntegrityConversationTurn:
    return IntegrityConversationTurn(
        integrity_check_submission_id=uuid.uuid4(),
        ordinal=ordinal,
        role=role,
        content=content,
        tool_name=kw.get("tool_name"),
        tool_use_id=kw.get("tool_use_id"),
    )


class TestBuildBriefing:
    def test_includes_problem_id_and_extracted_steps(self) -> None:
        briefing = build_problems_briefing([
            {
                "problem_id": "prob-1",
                "sample_position": 0,
                "question": "Solve x^2 - 5x + 6 = 0",
                "extraction": {
                    "steps": [
                        {"step_num": 1, "latex": "(x-2)(x-3)", "plain_english": "factored"},
                    ],
                    "confidence": 0.9,
                },
                "verdict_status": "pending",
            },
        ])
        assert "prob-1" in briefing
        assert "Solve x^2 - 5x + 6 = 0" in briefing
        assert "factored" in briefing
        assert "Current verdict: pending" in briefing

    def test_handles_no_extracted_steps(self) -> None:
        briefing = build_problems_briefing([
            {
                "problem_id": "prob-1",
                "sample_position": 0,
                "question": "Q",
                "extraction": {"steps": [], "confidence": 0.1},
                "verdict_status": "pending",
            },
        ])
        assert "(no legible steps)" in briefing


class TestBuildAgentMessages:
    def test_folds_student_and_agent_turns(self) -> None:
        turns = [
            _turn(0, "agent", "Hi! Walk me through step one on problem 1."),
            _turn(1, "student", "I multiplied the two numbers."),
            _turn(2, "agent", "Which two?"),
        ]
        messages = _build_agent_messages("BRIEFING", turns)
        # First user message = briefing kickoff
        assert messages[0]["role"] == "user"
        assert "BRIEFING" in messages[0]["content"]
        # Then: assistant text, user text, assistant text
        assert messages[1] == {
            "role": "assistant",
            "content": [{"type": "text", "text": "Hi! Walk me through step one on problem 1."}],
        }
        assert messages[2] == {"role": "user", "content": "I multiplied the two numbers."}
        assert messages[3]["role"] == "assistant"

    def test_groups_tool_call_after_agent_text(self) -> None:
        tool_input = {
            "problem_id": "p1",
            "rubric": {
                "paraphrase_originality": "high",
                "causal_fluency": "high",
            },
            "reasoning": "x",
        }
        turns = [
            _turn(0, "agent", "Hello"),
            _turn(
                1, "tool_call", json.dumps(tool_input),
                tool_name="submit_problem_verdict", tool_use_id="u1",
            ),
            _turn(2, "tool_result", "accepted", tool_use_id="u1"),
        ]
        messages = _build_agent_messages("B", turns)
        # Briefing + assistant (text + tool_use) + user (tool_result)
        assert len(messages) == 3
        assistant = messages[1]
        assert assistant["role"] == "assistant"
        assert len(assistant["content"]) == 2
        assert assistant["content"][0] == {"type": "text", "text": "Hello"}
        tool_use_block = assistant["content"][1]
        assert tool_use_block["type"] == "tool_use"
        assert tool_use_block["name"] == "submit_problem_verdict"
        assert tool_use_block["id"] == "u1"
        assert tool_use_block["input"] == tool_input
        tool_result = messages[2]
        assert tool_result["role"] == "user"
        assert tool_result["content"][0]["type"] == "tool_result"
        assert tool_result["content"][0]["tool_use_id"] == "u1"

    def test_standalone_tool_call_without_preceding_text(self) -> None:
        turns = [
            _turn(
                0, "tool_call", json.dumps({"a": 1}),
                tool_name="finish_check", tool_use_id="u9",
            ),
        ]
        messages = _build_agent_messages("B", turns)
        assert messages[1]["role"] == "assistant"
        assert messages[1]["content"][0]["type"] == "tool_use"
