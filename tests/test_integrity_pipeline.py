"""Unit tests for the integrity-checker score-to-badge logic and the
stub AI helpers. Pipeline-with-DB tests live in
test_integrity_check.py since they need the seeded fixtures.
"""

from __future__ import annotations

from api.core.integrity_pipeline import compute_badge

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


