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
    def test_parse_valid_json(self) -> None:
        raw = '''[
            {"description": "Subtract 6", "operation": "subtraction", "before": "2x + 6 = 12", "after": "2x = 6"},
            {"description": "Divide by 2", "operation": "division", "before": "2x = 6", "after": "x = 3"}
        ]'''
        steps = _parse_steps(raw)
        assert len(steps) == 2
        assert steps[0].description == "Subtract 6"
        assert steps[1].after == "x = 3"

    def test_parse_strips_markdown_fencing(self) -> None:
        raw = '```json\n[{"description": "step", "operation": "op", "before": "a", "after": "b"}]\n```'
        steps = _parse_steps(raw)
        assert len(steps) == 1

    def test_parse_invalid_json_raises(self) -> None:
        with pytest.raises(Exception):
            _parse_steps("not json at all")


class TestDecompositionDataclass:
    def test_decomposition_fields(self) -> None:
        d = Decomposition(
            problem="2x + 6 = 12",
            steps=[Step("sub 6", "subtraction", "2x+6=12", "2x=6")],
            final_answer="x = 3",
            problem_type="linear",
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
    assert result.problem_type == "quadratic"
    assert len(result.steps) >= 2


@pytest.mark.integration
@pytest.mark.asyncio
async def test_decompose_arithmetic() -> None:
    from api.core.step_decomposition import decompose_problem

    result = await decompose_problem("(3 + 5) * 2 - 4")
    assert len(result.steps) >= 1
