"""Regression guard: the generation prompt contains an explicit
difficulty calibration block.

The integrity pipeline (api/core/integrity_pipeline.py) ranks problems
by their `difficulty` label to pick the probe target. The label is
auto-emitted by the model at generation time. Without anchoring in the
prompt, the model used its own pretrained intuition and the labels
drifted between runs, weakening the probe selection. This test pins
the calibration text in so an accidental removal trips CI.
"""

from api.core.assignment_generation import _build_question_generation_prompt


def test_generation_prompt_contains_difficulty_calibration() -> None:
    prompt = _build_question_generation_prompt(subject="math")
    # The calibration block + its three definitions + the
    # "this course" anchor (so hard stays calibrated to the student
    # level, not absolute math difficulty).
    assert "Difficulty calibration" in prompt
    assert "easy:" in prompt
    assert "medium:" in prompt
    assert "hard:" in prompt
    assert "THIS course" in prompt
