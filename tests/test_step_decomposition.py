"""Tests for step decomposition.

All tests use mocked LLM responses — no real API calls.
"""

from unittest.mock import AsyncMock, patch

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
        steps, final_answer, answer_type, topic = _parse_decomposition(data)
        assert len(steps) == 2
        assert steps[0] == {"title": "", "description": "Subtract 6 from both sides to get 2x = 6"}
        assert final_answer == "x = 3"
        assert answer_type == "text"
        assert topic == ""

    def test_parse_with_answer_type(self) -> None:
        data = {
            "steps": ["Solve to get x = 3"],
            "final_answer": "x = 3",
            "answer_type": "diagram",
            "topic": "Algebra",
        }
        steps, final_answer, answer_type, topic = _parse_decomposition(data)
        assert len(steps) == 1
        assert final_answer == "x = 3"
        assert answer_type == "diagram"
        assert topic == "algebra"

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
        )
        assert d.problem_type == "linear"
        assert len(d.steps) == 2
        assert d.answer_type == "text"


MOCK_LLM_RESPONSE = {
    "steps": ["Subtract 6 from both sides to get 2x = 6", "Divide both sides by 2"],
    "final_answer": "x = 3",
}


@pytest.mark.asyncio
async def test_decompose_linear_equation() -> None:
    from api.core.step_decomposition import decompose_problem

    with patch("api.core.step_decomposition.call_claude_json", new_callable=AsyncMock) as mock:
        mock.return_value = MOCK_LLM_RESPONSE
        result = await decompose_problem("2*x + 6 = 12")
    assert result.problem_type == "math"
    assert len(result.steps) >= 2
    assert result.final_answer == "x = 3"


@pytest.mark.asyncio
async def test_decompose_quadratic() -> None:
    from api.core.step_decomposition import decompose_problem

    with patch("api.core.step_decomposition.call_claude_json", new_callable=AsyncMock) as mock:
        mock.return_value = {
            "steps": ["Factor the quadratic", "Set each factor to zero", "Solve for x"],
            "final_answer": "x = -2, x = -3",
            # distractors now generated separately: ["x = 2", "x = 3", "x = -6"],
        }
        result = await decompose_problem("x^2 + 5*x + 6 = 0")
    assert result.problem_type == "math"
    assert len(result.steps) >= 2


@pytest.mark.asyncio
async def test_decompose_arithmetic() -> None:
    from api.core.step_decomposition import decompose_problem

    with patch("api.core.step_decomposition.call_claude_json", new_callable=AsyncMock) as mock:
        mock.return_value = {
            "steps": ["Add 3 + 5 = 8", "Multiply 8 * 2 = 16", "Subtract 16 - 4 = 12"],
            "final_answer": "12",
            # distractors now generated separately: ["8", "16", "10"],
        }
        result = await decompose_problem("(3 + 5) * 2 - 4")
    assert len(result.steps) >= 1
