"""Tests for step decomposition.

Integration tests (marked with @pytest.mark.integration) call the real Claude API.
They are excluded in CI via `-m "not integration"` and only run locally.
"""

import pytest

from api.core.step_decomposition import (
    Decomposition,
    Step,
    _parse_steps,
)


class TestParseSteps:
    def test_parse_steps_dict(self) -> None:
        data = {
            "steps": [
                {"description": "Subtract 6", "operation": "subtraction", "before": "2x + 6 = 12", "after": "2x = 6"},
                {"description": "Divide by 2", "operation": "division", "before": "2x = 6", "after": "x = 3"},
            ],
        }
        steps, distractors = _parse_steps(data)
        assert len(steps) == 2
        assert steps[0].description == "Subtract 6"
        assert steps[1].after == "x = 3"
        assert distractors == []

    def test_parse_steps_with_distractors(self) -> None:
        data = {
            "steps": [{"description": "d", "operation": "o", "before": "a", "after": "x = 3"}],
            "distractors": ["x = 2", "x = 4", "x = -3"],
        }
        steps, distractors = _parse_steps(data)
        assert len(steps) == 1
        assert steps[0].after == "x = 3"
        assert distractors == ["x = 2", "x = 4", "x = -3"]

    def test_parse_steps_invalid_type_raises(self) -> None:
        with pytest.raises((KeyError, TypeError, ValueError)):
            _parse_steps({"steps": "not a list"})

    def test_parse_steps_missing_key_raises(self) -> None:
        with pytest.raises(KeyError):
            _parse_steps({})


class TestDecompositionDataclass:
    def test_decomposition_fields(self) -> None:
        d = Decomposition(
            problem="2x + 6 = 12",
            steps=[Step("sub 6", "subtraction", "2x+6=12", "2x=6")],
            final_answer="x = 3",
            problem_type="linear",
            distractors=["x = 2", "x = 4", "x = -3"],
        )
        assert d.problem_type == "linear"
        assert len(d.steps) == 1


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
