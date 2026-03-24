"""Tests for step decomposition.

Integration tests (marked with @pytest.mark.integration) call the real Claude API.
They are excluded in CI via `-m "not integration"` and only run locally.
"""

import pytest

from api.core.step_decomposition import (
    Decomposition,
    _parse_decomposition,
)


class TestParseDecomposition:
    def test_parse_steps(self) -> None:
        data = {
            "steps": [
                "Subtract 6 from both sides to get 2x = 6",
                "Divide both sides by 2 to get x = 3",
            ],
            "final_answer": "x = 3",
        }
        steps, final_answer, distractors = _parse_decomposition(data)
        assert len(steps) == 2
        assert steps[0] == "Subtract 6 from both sides to get 2x = 6"
        assert final_answer == "x = 3"
        assert distractors == []

    def test_parse_with_distractors(self) -> None:
        data = {
            "steps": ["Solve to get x = 3"],
            "final_answer": "x = 3",
            "distractors": ["x = 2", "x = 4", "x = -3"],
        }
        steps, final_answer, distractors = _parse_decomposition(data)
        assert len(steps) == 1
        assert final_answer == "x = 3"
        assert distractors == ["x = 2", "x = 4", "x = -3"]

    def test_parse_invalid_type_raises(self) -> None:
        with pytest.raises((KeyError, TypeError, ValueError)):
            _parse_decomposition({"steps": "not a list", "final_answer": "x"})

    def test_parse_missing_key_raises(self) -> None:
        with pytest.raises(KeyError):
            _parse_decomposition({})


class TestDecompositionDataclass:
    def test_decomposition_fields(self) -> None:
        d = Decomposition(
            problem="2x + 6 = 12",
            steps=["Subtract 6 from both sides", "Divide by 2"],
            final_answer="x = 3",
            problem_type="linear",
            distractors=["x = 2", "x = 4", "x = -3"],
        )
        assert d.problem_type == "linear"
        assert len(d.steps) == 2


# --- Integration tests (call real Claude API) ---


@pytest.mark.integration
@pytest.mark.asyncio
async def test_decompose_linear_equation() -> None:
    from api.core.step_decomposition import decompose_problem

    result = await decompose_problem("2*x + 6 = 12")
    assert result.problem_type == "math"
    assert len(result.steps) >= 2
    assert result.final_answer != ""


@pytest.mark.integration
@pytest.mark.asyncio
async def test_decompose_quadratic() -> None:
    from api.core.step_decomposition import decompose_problem

    result = await decompose_problem("x^2 + 5*x + 6 = 0")
    assert result.problem_type == "math"
    assert len(result.steps) >= 2


@pytest.mark.integration
@pytest.mark.asyncio
async def test_decompose_arithmetic() -> None:
    from api.core.step_decomposition import decompose_problem

    result = await decompose_problem("(3 + 5) * 2 - 4")
    assert len(result.steps) >= 1
