"""Unit tests for the integrity-checker score-to-badge logic and the
stub AI helpers. Pipeline-with-DB tests live in
test_integrity_check.py since they need the seeded fixtures.
"""

from __future__ import annotations

from api.core.integrity_pipeline import compute_badge
from api.core.integrity_stub import (
    generate_questions,
    rephrase_question,
    score_answer,
)

# ── compute_badge ──

class TestComputeBadge:
    def test_all_good_is_likely(self) -> None:
        badge, score = compute_badge(["good", "good", "good"], [])
        assert badge == "likely"
        assert score == 1.0

    def test_all_bad_is_unlikely(self) -> None:
        badge, score = compute_badge(["bad", "bad"], [])
        assert badge == "unlikely"
        assert score == 0.0

    def test_all_weak_lands_in_uncertain(self) -> None:
        # 0.5 average → between 0.40 and 0.75 → uncertain
        badge, score = compute_badge(["weak", "weak"], [])
        assert badge == "uncertain"
        assert score == 0.5

    def test_mixed_above_threshold_is_likely(self) -> None:
        # good + good + weak → (1 + 1 + 0.5) / 3 = 0.833 → likely
        badge, _ = compute_badge(["good", "good", "weak"], [])
        assert badge == "likely"

    def test_just_below_likely_threshold(self) -> None:
        # good + weak → (1 + 0.5) / 2 = 0.75 exactly → likely
        # (>= 0.75 maps to likely per the doc)
        badge, _ = compute_badge(["good", "weak"], [])
        assert badge == "likely"

    def test_just_below_uncertain_threshold(self) -> None:
        # bad + weak → (0 + 0.5) / 2 = 0.25 → unlikely
        badge, _ = compute_badge(["bad", "weak"], [])
        assert badge == "unlikely"

    def test_empty_verdicts_defensive(self) -> None:
        badge, score = compute_badge([], [])
        assert badge == "uncertain"
        assert score == 0.0

    def test_hard_flag_forces_unlikely_even_with_high_score(self) -> None:
        # Three goods would otherwise be 1.0 → likely. Hard flag
        # downgrades to unlikely.
        badge, score = compute_badge(["good", "good", "good"], ["contradicts_own_work"])
        assert badge == "unlikely"
        assert score == 1.0  # raw score still reflects answer quality

    def test_acknowledges_cheating_is_a_hard_flag(self) -> None:
        badge, _ = compute_badge(["good"], ["acknowledges_cheating"])
        assert badge == "unlikely"

    def test_soft_flag_does_not_escalate(self) -> None:
        # Currently the only hard flags are the two above; everything
        # else (vague, generic_textbook, etc.) leaves badge alone.
        badge, _ = compute_badge(["good", "good"], ["vague"])
        assert badge == "likely"

    def test_skipped_counts_as_zero(self) -> None:
        # good + skipped = 0.5 → uncertain
        badge, score = compute_badge(["good", "skipped"], [])
        assert badge == "uncertain"
        assert score == 0.5

    def test_rephrased_then_good_partial_credit(self) -> None:
        # rephrased weight = 0.8 per the parent plan §6
        badge, score = compute_badge(["rephrased"], [])
        assert badge == "likely"  # 0.8 >= 0.75
        assert score == 0.8

    def test_unknown_verdict_treated_as_zero(self) -> None:
        # Defensive: an unexpected verdict string should not crash,
        # just contribute zero to the average.
        badge, score = compute_badge(["good", "wat"], [])
        # (1.0 + 0.0) / 2 = 0.5 → uncertain
        assert badge == "uncertain"
        assert score == 0.5


# ── stub helpers ──

class TestStub:
    def test_generate_questions_returns_two(self) -> None:
        qs = generate_questions("Solve x^2 - 5x + 6 = 0", {"steps": []})
        assert len(qs) == 2
        assert all("question_text" in q for q in qs)
        assert all("expected_shape" in q for q in qs)

    def test_score_answer_thresholds(self) -> None:
        q = {"question_text": "x"}
        # < 5 chars → bad
        assert score_answer(q, "abc")["verdict"] == "bad"
        assert score_answer(q, "")["verdict"] == "bad"
        assert score_answer(q, "    ")["verdict"] == "bad"  # whitespace stripped
        # 5..29 chars → weak
        assert score_answer(q, "12345")["verdict"] == "weak"
        assert score_answer(q, "x" * 29)["verdict"] == "weak"
        # >= 30 → good
        assert score_answer(q, "x" * 30)["verdict"] == "good"
        assert score_answer(q, "x" * 100)["verdict"] == "good"

    def test_score_answer_emits_required_fields(self) -> None:
        out = score_answer({"question_text": "x"}, "decent answer here")
        assert "verdict" in out
        assert "reasoning" in out
        assert "flags" in out
        assert isinstance(out["flags"], list)

    def test_rephrase_marks_alternative(self) -> None:
        text = rephrase_question({"question_text": "What was your first step?"})
        assert "first step" in text
        assert text != "What was your first step?"
