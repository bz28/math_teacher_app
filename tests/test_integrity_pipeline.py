"""Unit tests for the integrity-checker agent-loop helpers.

Pipeline-with-DB tests live in test_integrity_check.py since they
need the seeded world fixture. This file exercises the pure helpers
— problem briefing, transcript-to-messages folding, tool-input
validation, probe selection — so regressions in the prompt shape
or selection algorithm are caught fast.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

from api.core.integrity_ai import build_problems_briefing
from api.core.integrity_pipeline import (
    SELECTION_REASON_HIGHEST_DIFFERENTIATION,
    _build_agent_messages,
    _validate_rubric,
    select_probe_problems,
)
from api.models.integrity_check import IntegrityConversationTurn


@dataclass
class _FakeItem:
    """Stand-in for QuestionBankItem that carries just the fields
    select_probe_problems looks at. Spares these tests from the full
    ORM + DB setup."""
    id: uuid.UUID
    difficulty: str | None
    solution_steps: list[Any] | None


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


class TestSelectProbeProblems:
    def _item(
        self, difficulty: str | None = "medium", steps: int = 3,
    ) -> _FakeItem:
        return _FakeItem(
            id=uuid.uuid4(),
            difficulty=difficulty,
            solution_steps=[{"step_num": i + 1} for i in range(steps)],
        )

    def test_picks_highest_difficulty(self) -> None:
        easy = self._item(difficulty="easy", steps=10)
        medium = self._item(difficulty="medium", steps=5)
        hard = self._item(difficulty="hard", steps=2)
        items_by_id = {easy.id: easy, medium.id: medium, hard.id: hard}

        picked, reason = select_probe_problems(
            items_by_id, [easy.id, medium.id, hard.id], max_picks=1,
        )
        assert picked == [hard.id]
        assert reason == SELECTION_REASON_HIGHEST_DIFFERENTIATION

    def test_tiebreak_on_solution_step_count(self) -> None:
        # Both hard — tiebreak wins on more steps.
        short_hard = self._item(difficulty="hard", steps=2)
        long_hard = self._item(difficulty="hard", steps=7)
        items_by_id = {short_hard.id: short_hard, long_hard.id: long_hard}

        picked, _ = select_probe_problems(
            items_by_id, [short_hard.id, long_hard.id], max_picks=1,
        )
        assert picked == [long_hard.id]

    def test_unknown_difficulty_treated_as_medium(self) -> None:
        # Stray string or null doesn't crash selection.
        unknown = self._item(difficulty="impossible", steps=10)
        medium = self._item(difficulty="medium", steps=1)
        items_by_id = {unknown.id: unknown, medium.id: medium}

        picked, _ = select_probe_problems(
            items_by_id, [unknown.id, medium.id], max_picks=1,
        )
        # Both rank as "medium" in difficulty → step count breaks the tie.
        assert picked == [unknown.id]

    def test_drops_missing_items(self) -> None:
        present = self._item(difficulty="hard", steps=4)
        missing = uuid.uuid4()  # not in items_by_id
        items_by_id = {present.id: present}

        picked, reason = select_probe_problems(
            items_by_id, [missing, present.id], max_picks=1,
        )
        assert picked == [present.id]
        assert reason == SELECTION_REASON_HIGHEST_DIFFERENTIATION

    def test_empty_input_returns_empty_picks(self) -> None:
        picked, reason = select_probe_problems({}, [], max_picks=1)
        assert picked == []
        assert reason == SELECTION_REASON_HIGHEST_DIFFERENTIATION


class TestValidateRubric:
    def test_accepts_minimal_rubric(self) -> None:
        rubric, err = _validate_rubric({
            "paraphrase_originality": "high",
            "causal_fluency": "high",
        })
        assert err is None
        assert rubric is not None
        # Missing optional dimensions default to the right sentinel.
        assert rubric["transfer"] == "not_probed"
        assert rubric["prediction"] == "not_probed"
        assert rubric["authority_resistance"] == "not_probed"
        assert rubric["self_correction"] == "not_observed"

    def test_accepts_full_rubric(self) -> None:
        rubric, err = _validate_rubric({
            "paraphrase_originality": "mid",
            "causal_fluency": "low",
            "transfer": "high",
            "prediction": "mid",
            "authority_resistance": "low",
            "self_correction": "mid",
        })
        assert err is None
        assert rubric == {
            "paraphrase_originality": "mid",
            "causal_fluency": "low",
            "transfer": "high",
            "prediction": "mid",
            "authority_resistance": "low",
            "self_correction": "mid",
        }

    def test_rejects_non_dict(self) -> None:
        rubric, err = _validate_rubric("not a dict")
        assert rubric is None
        assert err is not None
        assert "object" in err

    def test_rejects_not_probed_on_required_dimension(self) -> None:
        # paraphrase_originality / causal_fluency come from the open
        # walkthrough — always observed, so "not_probed" is invalid.
        rubric, err = _validate_rubric({
            "paraphrase_originality": "not_probed",
            "causal_fluency": "high",
        })
        assert rubric is None
        assert err is not None
        assert "paraphrase_originality" in err

    def test_rejects_low_mid_high_on_self_correction_is_ok(self) -> None:
        # self_correction accepts low/mid/high OR not_observed.
        rubric, err = _validate_rubric({
            "paraphrase_originality": "high",
            "causal_fluency": "high",
            "self_correction": "not_observed",
        })
        assert err is None
        assert rubric is not None
        assert rubric["self_correction"] == "not_observed"

    def test_rejects_garbage_enum_value(self) -> None:
        rubric, err = _validate_rubric({
            "paraphrase_originality": "high",
            "causal_fluency": "excellent",  # not in low/mid/high
        })
        assert rubric is None
        assert err is not None
        assert "causal_fluency" in err
