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
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.core.integrity_ai import build_problems_briefing
from api.core.integrity_pipeline import (
    ACTIVITY_DOMINANT_TAB_OUT_RATIO,
    ACTIVITY_LARGE_PASTE_CHARS,
    ACTIVITY_LONG_TAB_OUT_MS,
    ACTIVITY_REASON_DOMINANT_TAB_OUT,
    ACTIVITY_REASON_FULL_PASTE,
    ACTIVITY_REASON_LARGE_PASTE,
    ACTIVITY_REASON_LONG_TAB_OUT,
    SELECTION_REASON_HIGHEST_DIFFERENTIATION,
    _build_agent_messages,
    _normalize_answer_for_trivial_match,
    _validate_rubric,
    check_answer_correctness,
    compute_activity_summary,
    select_probe_problems,
)
from api.models.integrity_check import IntegrityConversationTurn


@dataclass
class _FakeItem:
    """Stand-in for QuestionBankItem that carries just the fields
    select_probe_problems + check_answer_correctness look at. Spares
    these tests from the full ORM + DB setup."""
    id: uuid.UUID
    difficulty: str | None = "medium"
    solution_steps: list[Any] | None = field(default_factory=list)
    final_answer: str | None = None


def _turn(ordinal: int, role: str, content: str, **kw: Any) -> IntegrityConversationTurn:
    return IntegrityConversationTurn(
        integrity_check_submission_id=uuid.uuid4(),
        ordinal=ordinal,
        role=role,
        content=content,
        tool_name=kw.get("tool_name"),
        tool_use_id=kw.get("tool_use_id"),
        seconds_on_turn=kw.get("seconds_on_turn"),
        telemetry=kw.get("telemetry"),
    )


def _student_turn(
    ordinal: int,
    content: str = "ok",
    *,
    seconds_on_turn: int | None = None,
    blurs: list[dict[str, Any]] | None = None,
    pastes: list[dict[str, Any]] | None = None,
    cadence: dict[str, Any] | None = None,
) -> IntegrityConversationTurn:
    """Build a student turn with telemetry slotted in. Defaults to a
    clean turn (no events) when args are omitted, so individual tests
    only specify the signal they care about."""
    telemetry = {
        "focus_blur_events": blurs or [],
        "paste_events": pastes or [],
        "typing_cadence": cadence,
        "need_more_time_used": False,
        "device_type": "desktop",
    }
    return _turn(
        ordinal, "student", content,
        seconds_on_turn=seconds_on_turn,
        telemetry=telemetry,
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

    def test_includes_correct_final_answer_when_present(self) -> None:
        # The agent uses the answer key to anchor "right vs wrong on
        # paper" instead of mentally re-solving. Briefing surfaces it
        # under a labeled line so the agent can find it deterministically.
        briefing = build_problems_briefing([
            {
                "problem_id": "prob-1",
                "sample_position": 0,
                "question": "Solve x^2 - 5x + 6 = 0",
                "correct_final_answer": "x = 2 or x = 3",
                "extraction": {"steps": [], "confidence": 0.9},
                "verdict_status": "pending",
            },
        ])
        assert "Correct final answer (answer key): x = 2 or x = 3" in briefing

    def test_omits_answer_line_when_final_answer_missing(self) -> None:
        # Legacy bank items have null final_answer. We should not emit
        # an empty "Correct final answer:" line — the agent would treat
        # the empty string as a real (and absurd) ground truth.
        for missing in (None, "", "   "):
            briefing = build_problems_briefing([
                {
                    "problem_id": "prob-1",
                    "sample_position": 0,
                    "question": "Q",
                    "correct_final_answer": missing,
                    "extraction": {"steps": [], "confidence": 0.5},
                    "verdict_status": "pending",
                },
            ])
            assert "Correct final answer" not in briefing, (
                f"expected no answer-key line when final_answer is {missing!r}"
            )


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


class TestNormalizeAnswerForTrivialMatch:
    def test_strips_whitespace_and_double_dollar_wrapper(self) -> None:
        assert _normalize_answer_for_trivial_match("  $$ 6 $$  ") == "6"

    def test_strips_single_dollar_wrapper(self) -> None:
        assert _normalize_answer_for_trivial_match("$x = 5$") == "x = 5"

    def test_leaves_unwrapped_strings_alone(self) -> None:
        assert _normalize_answer_for_trivial_match("6") == "6"
        assert _normalize_answer_for_trivial_match("\\frac{1}{2}") == "\\frac{1}{2}"

    def test_strips_double_dollar_when_both_ends_match(self) -> None:
        # Single $ sandwich inside a $$ wrapper: outer $$ wins, inner
        # $...$ stays. We're not trying to be a full LaTeX parser —
        # only the trivial fast path.
        assert _normalize_answer_for_trivial_match("$$x = 5$$") == "x = 5"

    def test_does_not_strip_unbalanced_wrapper(self) -> None:
        assert _normalize_answer_for_trivial_match("$5") == "$5"
        assert _normalize_answer_for_trivial_match("5$") == "5$"


class TestCheckAnswerCorrectness:
    def _setup(self, items_with_answers: list[tuple[str | None, int]]) -> tuple[
        dict[uuid.UUID, _FakeItem], dict[uuid.UUID, int]
    ]:
        """Build (items_by_id, hw_position_by_id) from a list of
        (final_answer, hw_position) pairs. Each item gets a fresh UUID."""
        items: dict[uuid.UUID, _FakeItem] = {}
        positions: dict[uuid.UUID, int] = {}
        for answer, pos in items_with_answers:
            item = _FakeItem(id=uuid.uuid4(), final_answer=answer)
            items[item.id] = item
            positions[item.id] = pos
        return items, positions

    @pytest.mark.asyncio
    async def test_trivial_match_skips_llm(self) -> None:
        # Both wrapper styles + plain numerics: all should match
        # without hitting the LLM at all.
        items, positions = self._setup([
            ("$6$", 1),
            ("$$x = 5$$", 2),
            ("7", 3),
        ])
        extraction = {
            "final_answers": [
                {"problem_position": 1, "answer_latex": "6"},
                {"problem_position": 2, "answer_latex": "x = 5"},
                {"problem_position": 3, "answer_latex": "7"},
            ],
        }
        with patch(
            "api.core.integrity_pipeline.call_claude_json",
            new=AsyncMock(),
        ) as mock_llm:
            correct = await check_answer_correctness(
                extraction, items, positions,
            )
        assert all(correct.values())
        mock_llm.assert_not_called()

    @pytest.mark.asyncio
    async def test_llm_called_for_uncertain_pairs(self) -> None:
        # Bank "1/2" vs student "0.5" — trivial match fails, LLM
        # decides equivalence.
        items, positions = self._setup([
            ("$\\frac{1}{2}$", 1),
        ])
        extraction = {
            "final_answers": [
                {"problem_position": 1, "answer_latex": "0.5"},
            ],
        }
        with patch(
            "api.core.integrity_pipeline.call_claude_json",
            new=AsyncMock(return_value={
                "results": [{"problem_position": 1, "equivalent": True}],
            }),
        ) as mock_llm:
            correct = await check_answer_correctness(
                extraction, items, positions,
            )
        assert all(correct.values())
        mock_llm.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_llm_returns_not_equivalent(self) -> None:
        items, positions = self._setup([
            ("$5$", 1),
        ])
        extraction = {
            "final_answers": [
                {"problem_position": 1, "answer_latex": "7"},
            ],
        }
        with patch(
            "api.core.integrity_pipeline.call_claude_json",
            new=AsyncMock(return_value={
                "results": [{"problem_position": 1, "equivalent": False}],
            }),
        ):
            correct = await check_answer_correctness(
                extraction, items, positions,
            )
        assert list(correct.values()) == [False]

    @pytest.mark.asyncio
    async def test_null_bank_answer_is_false_no_llm(self) -> None:
        # Proof-style problem with no canonical final answer in the
        # bank — should mark False without calling the LLM.
        items, positions = self._setup([(None, 1)])
        extraction = {
            "final_answers": [
                {"problem_position": 1, "answer_latex": "QED"},
            ],
        }
        with patch(
            "api.core.integrity_pipeline.call_claude_json",
            new=AsyncMock(),
        ) as mock_llm:
            correct = await check_answer_correctness(
                extraction, items, positions,
            )
        assert list(correct.values()) == [False]
        mock_llm.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_student_answer_is_false_no_llm(self) -> None:
        # Bank has an answer; Vision didn't extract one for this
        # problem (kid skipped it or answer was unreadable).
        items, positions = self._setup([("$6$", 1)])
        extraction = {"final_answers": []}
        with patch(
            "api.core.integrity_pipeline.call_claude_json",
            new=AsyncMock(),
        ) as mock_llm:
            correct = await check_answer_correctness(
                extraction, items, positions,
            )
        assert list(correct.values()) == [False]
        mock_llm.assert_not_called()

    @pytest.mark.asyncio
    async def test_llm_failure_treats_uncertain_as_wrong(self) -> None:
        # If the LLM call raises, we degrade gracefully — every
        # uncertain pair is False, system never wedges.
        items, positions = self._setup([
            ("$\\frac{1}{2}$", 1),
            ("$6$", 2),
        ])
        extraction = {
            "final_answers": [
                {"problem_position": 1, "answer_latex": "0.5"},
                {"problem_position": 2, "answer_latex": "6"},  # trivial-match True
            ],
        }
        with patch(
            "api.core.integrity_pipeline.call_claude_json",
            new=AsyncMock(side_effect=RuntimeError("circuit open")),
        ):
            correct = await check_answer_correctness(
                extraction, items, positions,
            )
        # Trivial match still wins for problem 2; problem 1 falls
        # through to "false" because the LLM failed.
        true_count = sum(correct.values())
        assert true_count == 1

    @pytest.mark.asyncio
    async def test_mixed_results(self) -> None:
        # One trivial-True, one LLM-True, one LLM-False.
        items, positions = self._setup([
            ("$6$", 1),
            ("$\\frac{1}{2}$", 2),
            ("$5$", 3),
        ])
        extraction = {
            "final_answers": [
                {"problem_position": 1, "answer_latex": "6"},
                {"problem_position": 2, "answer_latex": "0.5"},
                {"problem_position": 3, "answer_latex": "7"},
            ],
        }
        with patch(
            "api.core.integrity_pipeline.call_claude_json",
            new=AsyncMock(return_value={
                "results": [
                    {"problem_position": 2, "equivalent": True},
                    {"problem_position": 3, "equivalent": False},
                ],
            }),
        ):
            correct = await check_answer_correctness(
                extraction, items, positions,
            )
        # Order isn't guaranteed by dict, so check by item.
        item_ids = list(items.keys())
        # Problems are at positions 1, 2, 3 in registration order
        assert correct[item_ids[0]] is True   # trivial match
        assert correct[item_ids[1]] is True   # LLM equivalent
        assert correct[item_ids[2]] is False  # LLM not-equivalent


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


class TestComputeActivitySummary:
    def test_returns_none_when_no_telemetry(self) -> None:
        # Agent + tool turns alone — no student telemetry to roll up.
        turns = [
            _turn(0, "agent", "Hi"),
            _turn(1, "tool_call", "{}", tool_name="finish_check"),
        ]
        assert compute_activity_summary(turns) is None

    def test_returns_none_when_only_agent_turns(self) -> None:
        # Even with a student turn, if telemetry is None the rollup
        # has nothing to summarise. Agent turns never carry telemetry.
        turns = [
            _turn(0, "agent", "Hi"),
            _turn(1, "student", "Hi", telemetry=None),
        ]
        assert compute_activity_summary(turns) is None

    def test_clean_when_only_quiet_typing(self) -> None:
        turns = [_student_turn(
            0, "I added 2 + 2",
            seconds_on_turn=20,
            cadence={"total_ms": 18_000, "pauses_over_3s": 0, "edits": 1},
        )]
        summary = compute_activity_summary(turns)
        assert summary is not None
        assert summary["notable_turns"] == []
        # Totals are still populated for display, just zeros.
        assert summary["totals"]["paste_count"] == 0
        assert summary["totals"]["tab_out_count"] == 0

    def test_notable_when_one_large_paste(self) -> None:
        turns = [_student_turn(
            0, "Sure, here's my reasoning… " * 10,
            seconds_on_turn=30,
            pastes=[{"at": "2026-04-26T00:00:00Z", "byte_count": 250}],
            cadence={"total_ms": 5_000, "pauses_over_3s": 0, "edits": 0},
        )]
        summary = compute_activity_summary(turns)
        assert summary is not None
        assert len(summary["notable_turns"]) == 1
        nt = summary["notable_turns"][0]
        assert nt["ordinal"] == 0
        assert ACTIVITY_REASON_LARGE_PASTE in nt["reasons"]
        assert summary["totals"]["paste_count"] == 1
        assert summary["totals"]["paste_largest_chars"] == 250

    def test_heavy_when_full_paste_with_no_typing(self) -> None:
        # Pasted answer = paste size matches content length and the
        # student didn't type anything. full_paste alone is enough to
        # escalate the session to heavy — that's the single-turn
        # severity rule. Content is intentionally short (below the
        # large_paste threshold) so the test pins the rule to
        # full_paste, not paste-volume.
        content = "x = 5 here"
        turns = [_student_turn(
            0, content,
            seconds_on_turn=8,
            pastes=[{
                "at": "2026-04-26T00:00:00Z",
                "byte_count": len(content),
            }],
            cadence={"total_ms": 0, "pauses_over_3s": 0, "edits": 0},
        )]
        summary = compute_activity_summary(turns)
        assert summary is not None
        nt = summary["notable_turns"][0]
        assert ACTIVITY_REASON_FULL_PASTE in nt["reasons"]
        # Below the large_paste byte threshold — only full_paste fires.
        assert ACTIVITY_REASON_LARGE_PASTE not in nt["reasons"]

    def test_heavy_when_two_notable_turns(self) -> None:
        # Two separate turns with notable signals — even without a
        # full_paste, two-or-more notable turns escalates to heavy.
        turns = [
            _student_turn(
                0, "answer one",
                seconds_on_turn=10,
                pastes=[{"at": "x", "byte_count": 200}],
            ),
            _student_turn(
                1, "answer two",
                seconds_on_turn=60,
                blurs=[{"at": "x", "duration_ms": 15_000}],
            ),
        ]
        summary = compute_activity_summary(turns)
        assert summary is not None
        assert len(summary["notable_turns"]) == 2

    def test_long_tab_out_flags_single_long_blur(self) -> None:
        turns = [_student_turn(
            0, "ok",
            seconds_on_turn=120,
            blurs=[{"at": "x", "duration_ms": 15_000}],
        )]
        summary = compute_activity_summary(turns)
        assert summary is not None
        nt = summary["notable_turns"][0]
        assert ACTIVITY_REASON_LONG_TAB_OUT in nt["reasons"]

    def test_dominant_tab_out_flags_proportional_blur_without_single_long_event(self) -> None:
        # Many short blurs that cumulatively dominate a long turn.
        # Each blur is under the long-event threshold, so only the
        # dominant ratio rule should fire.
        turns = [_student_turn(
            0, "ok",
            seconds_on_turn=60,
            blurs=[
                {"at": "a", "duration_ms": 8_000},
                {"at": "b", "duration_ms": 7_000},
                {"at": "c", "duration_ms": 6_000},
            ],
        )]
        summary = compute_activity_summary(turns)
        assert summary is not None
        nt = summary["notable_turns"][0]
        assert ACTIVITY_REASON_DOMINANT_TAB_OUT in nt["reasons"]
        assert ACTIVITY_REASON_LONG_TAB_OUT not in nt["reasons"]

    def test_does_not_double_count_when_long_tab_out_dominates(self) -> None:
        # One long blur on a short turn — long_tab_out fires;
        # dominant_tab_out is suppressed so the same evidence isn't
        # stacked under two reason codes.
        turns = [_student_turn(
            0, "ok",
            seconds_on_turn=40,
            blurs=[{"at": "x", "duration_ms": 15_000}],
        )]
        summary = compute_activity_summary(turns)
        assert summary is not None
        nt = summary["notable_turns"][0]
        assert ACTIVITY_REASON_LONG_TAB_OUT in nt["reasons"]
        assert ACTIVITY_REASON_DOMINANT_TAB_OUT not in nt["reasons"]

    def test_totals_aggregate_across_turns(self) -> None:
        turns = [
            _student_turn(
                0, "answer one",
                seconds_on_turn=20,
                pastes=[{"at": "x", "byte_count": 50}],
                blurs=[{"at": "x", "duration_ms": 5_000}],
                cadence={"total_ms": 10_000, "pauses_over_3s": 1, "edits": 0},
            ),
            _student_turn(
                1, "answer two",
                seconds_on_turn=20,
                pastes=[{"at": "y", "byte_count": 75}],
                blurs=[{"at": "y", "duration_ms": 8_000}],
                cadence={"total_ms": 12_000, "pauses_over_3s": 2, "edits": 0},
            ),
        ]
        summary = compute_activity_summary(turns)
        assert summary is not None
        totals = summary["totals"]
        assert totals["paste_count"] == 2
        assert totals["paste_total_chars"] == 125
        assert totals["paste_largest_chars"] == 75
        assert totals["tab_out_count"] == 2
        assert totals["tab_out_total_ms"] == 13_000

    # ── Threshold boundary cases ────────────────────────────────────
    # Pin the >= semantic at the exact threshold value so a future
    # off-by-one (e.g. accidentally switching to >) is caught.

    def test_large_paste_fires_at_exactly_threshold(self) -> None:
        turns = [_student_turn(
            0, "x" * ACTIVITY_LARGE_PASTE_CHARS,
            seconds_on_turn=10,
            pastes=[{"at": "x", "byte_count": ACTIVITY_LARGE_PASTE_CHARS}],
        )]
        summary = compute_activity_summary(turns)
        assert summary is not None
        nt = summary["notable_turns"][0]
        assert ACTIVITY_REASON_LARGE_PASTE in nt["reasons"]

    def test_large_paste_does_not_fire_one_below_threshold(self) -> None:
        turns = [_student_turn(
            0, "x" * (ACTIVITY_LARGE_PASTE_CHARS - 1),
            seconds_on_turn=10,
            pastes=[{"at": "x", "byte_count": ACTIVITY_LARGE_PASTE_CHARS - 1}],
        )]
        summary = compute_activity_summary(turns)
        # Either None (no notable turns) or the turn isn't flagged.
        assert summary is None or all(
            ACTIVITY_REASON_LARGE_PASTE not in nt["reasons"]
            for nt in summary["notable_turns"]
        )

    def test_long_tab_out_fires_at_exactly_threshold(self) -> None:
        turns = [_student_turn(
            0, "ok",
            seconds_on_turn=60,
            blurs=[{"at": "x", "duration_ms": ACTIVITY_LONG_TAB_OUT_MS}],
        )]
        summary = compute_activity_summary(turns)
        assert summary is not None
        nt = summary["notable_turns"][0]
        assert ACTIVITY_REASON_LONG_TAB_OUT in nt["reasons"]

    def test_long_tab_out_does_not_fire_one_below_threshold(self) -> None:
        turns = [_student_turn(
            0, "ok",
            seconds_on_turn=60,
            blurs=[{"at": "x", "duration_ms": ACTIVITY_LONG_TAB_OUT_MS - 1}],
        )]
        summary = compute_activity_summary(turns)
        assert summary is None or all(
            ACTIVITY_REASON_LONG_TAB_OUT not in nt["reasons"]
            for nt in summary["notable_turns"]
        )

    def test_dominant_tab_out_fires_at_exactly_threshold(self) -> None:
        # Build cumulative blur exactly at the ratio boundary, with
        # each individual blur kept under the long-tab-out threshold.
        seconds_on_turn = 60
        target_ms = int(ACTIVITY_DOMINANT_TAB_OUT_RATIO * seconds_on_turn * 1000)
        per_event = ACTIVITY_LONG_TAB_OUT_MS - 1
        # Spread the target across enough events to keep each one
        # under the long-tab-out threshold.
        events = [
            {"at": str(i), "duration_ms": per_event}
            for i in range(target_ms // per_event)
        ]
        remainder = target_ms - sum(e["duration_ms"] for e in events)
        if remainder > 0:
            events.append({"at": "tail", "duration_ms": remainder})
        turns = [_student_turn(
            0, "ok",
            seconds_on_turn=seconds_on_turn,
            blurs=events,
        )]
        summary = compute_activity_summary(turns)
        assert summary is not None
        nt = summary["notable_turns"][0]
        assert ACTIVITY_REASON_DOMINANT_TAB_OUT in nt["reasons"]
        assert ACTIVITY_REASON_LONG_TAB_OUT not in nt["reasons"]
