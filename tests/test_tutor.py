"""Tests for the LLM tutor layer.

Unit tests mock Claude responses. Integration tests (marked @pytest.mark.integration)
call the real API and are excluded from CI.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient

from api.core.tutor import (
    CircuitBreaker,
    CircuitState,
    CostTracker,
    EvalResult,
    ProbeResult,
)

# ---------------------------------------------------------------------------
# Unit tests: circuit breaker
# ---------------------------------------------------------------------------


class TestCircuitBreaker:
    def test_starts_closed(self) -> None:
        cb = CircuitBreaker()
        assert cb.allow_request() is True

    def test_opens_after_threshold(self) -> None:
        cb = CircuitBreaker(failure_threshold=3)
        for _ in range(3):
            cb.record_failure()
        assert cb.allow_request() is False

    def test_resets_on_success(self) -> None:
        cb = CircuitBreaker(failure_threshold=3)
        cb.record_failure()
        cb.record_failure()
        cb.record_success()
        assert cb._failure_count == 0
        assert cb.allow_request() is True

    def test_half_open_after_cooldown(self) -> None:
        cb = CircuitBreaker(failure_threshold=1, cooldown_seconds=0.0)
        cb.record_failure()
        # cooldown_seconds=0 so it should immediately allow
        assert cb.allow_request() is True
        assert cb._state == CircuitState.HALF_OPEN


# ---------------------------------------------------------------------------
# Unit tests: cost tracker
# ---------------------------------------------------------------------------


class TestCostTracker:
    def test_tracks_cost(self) -> None:
        ct = CostTracker()
        ct.add(0.01)
        ct.add(0.02)
        assert abs(ct.total_usd - 0.03) < 1e-9


# ---------------------------------------------------------------------------
# Unit tests: evaluate endpoint (mocked Claude)
# ---------------------------------------------------------------------------


def _mock_stream_context(response_text: str, input_tokens: int = 50, output_tokens: int = 30):
    """Create a mock for client.messages.stream() context manager."""
    # Mock the text_stream async iterator
    async def mock_text_stream():
        yield response_text

    # Mock the final message
    mock_message = MagicMock()
    mock_message.usage.input_tokens = input_tokens
    mock_message.usage.output_tokens = output_tokens

    # Mock the async context manager
    mock_stream = AsyncMock()
    mock_stream.text_stream = mock_text_stream()
    mock_stream.get_final_message = AsyncMock(return_value=mock_message)

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_stream)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    return mock_ctx


@pytest.mark.anyio
async def test_evaluate_correct(client: AsyncClient) -> None:
    response_json = json.dumps({"is_correct": True, "feedback": "Great job!"})

    with patch("api.core.tutor.anthropic.AsyncAnthropic") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.messages.stream = MagicMock(return_value=_mock_stream_context(response_json))
        mock_cls.return_value = mock_instance

        resp = await client.post("/v1/tutor/evaluate", json={
            "correct_step": "x = 3",
            "student_response": "3",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_correct"] is True
        assert data["feedback"] == "Great job!"


@pytest.mark.anyio
async def test_evaluate_incorrect(client: AsyncClient) -> None:
    response_json = json.dumps({"is_correct": False, "feedback": "Check your arithmetic."})

    with patch("api.core.tutor.anthropic.AsyncAnthropic") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.messages.stream = MagicMock(return_value=_mock_stream_context(response_json))
        mock_cls.return_value = mock_instance

        resp = await client.post("/v1/tutor/evaluate", json={
            "correct_step": "x = 3",
            "student_response": "5",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_correct"] is False


# ---------------------------------------------------------------------------
# Unit tests: explain endpoint (mocked Claude, streaming)
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_explain_streams_sse(client: AsyncClient) -> None:
    with patch("api.core.tutor.anthropic.AsyncAnthropic") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.messages.stream = MagicMock(
            return_value=_mock_stream_context("Let me explain this step.")
        )
        mock_cls.return_value = mock_instance

        resp = await client.post("/v1/tutor/explain", json={
            "step": "Subtract 6 from both sides",
            "grade_level": 7,
        })
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "text/event-stream; charset=utf-8"
        assert "data:" in resp.text
        assert "[DONE]" in resp.text


@pytest.mark.anyio
async def test_explain_with_error(client: AsyncClient) -> None:
    with patch("api.core.tutor.anthropic.AsyncAnthropic") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.messages.stream = MagicMock(
            return_value=_mock_stream_context("You made a sign error.")
        )
        mock_cls.return_value = mock_instance

        resp = await client.post("/v1/tutor/explain", json={
            "step": "Subtract 6 from both sides",
            "error": "Added 6 instead of subtracting",
            "grade_level": 5,
        })
        assert resp.status_code == 200
        assert "data:" in resp.text


# ---------------------------------------------------------------------------
# Unit tests: probe endpoint (mocked Claude)
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_probe_clear(client: AsyncClient) -> None:
    response_json = json.dumps({"understanding": "clear", "follow_up": None})

    with patch("api.core.tutor.anthropic.AsyncAnthropic") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.messages.stream = MagicMock(return_value=_mock_stream_context(response_json))
        mock_cls.return_value = mock_instance

        resp = await client.post("/v1/tutor/probe", json={
            "step": "Subtract 6 from both sides to isolate x",
            "student_explanation": "I subtracted 6 from both sides because I need x alone",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["understanding"] == "clear"
        assert data["follow_up"] is None


@pytest.mark.anyio
async def test_probe_partial(client: AsyncClient) -> None:
    response_json = json.dumps({
        "understanding": "partial",
        "follow_up": "Why do we subtract from both sides?",
    })

    with patch("api.core.tutor.anthropic.AsyncAnthropic") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.messages.stream = MagicMock(return_value=_mock_stream_context(response_json))
        mock_cls.return_value = mock_instance

        resp = await client.post("/v1/tutor/probe", json={
            "step": "Subtract 6 from both sides",
            "student_explanation": "I moved the 6 over",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["understanding"] == "partial"
        assert data["follow_up"] is not None


# ---------------------------------------------------------------------------
# Unit tests: schema validation
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_evaluate_missing_fields(client: AsyncClient) -> None:
    resp = await client.post("/v1/tutor/evaluate", json={})
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_probe_missing_fields(client: AsyncClient) -> None:
    resp = await client.post("/v1/tutor/probe", json={"step": "x"})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Integration tests (call real Claude API — excluded from CI)
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.anyio
async def test_evaluate_real_correct() -> None:
    from api.core.tutor import evaluate
    result = await evaluate(correct_step="x = 3", student_response="3")
    assert isinstance(result, EvalResult)
    assert result.is_correct is True


@pytest.mark.integration
@pytest.mark.anyio
async def test_evaluate_real_incorrect() -> None:
    from api.core.tutor import evaluate
    result = await evaluate(correct_step="x = 3", student_response="5")
    assert isinstance(result, EvalResult)
    assert result.is_correct is False


@pytest.mark.integration
@pytest.mark.anyio
async def test_explain_real_streams() -> None:
    from api.core.tutor import explain
    chunks = []
    async for chunk in explain(step="Subtract 6 from both sides", error=None, grade_level=7):
        chunks.append(chunk)
    assert len(chunks) > 0
    assert len("".join(chunks)) > 10


@pytest.mark.integration
@pytest.mark.anyio
async def test_probe_real() -> None:
    from api.core.tutor import probe
    result = await probe(
        step="Subtract 6 from both sides to isolate x",
        student_explanation="I subtracted 6 because I need to get x by itself",
    )
    assert isinstance(result, ProbeResult)
    assert result.understanding in ("clear", "partial", "wrong")
