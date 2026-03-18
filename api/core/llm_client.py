"""Shared LLM client: singleton, call helpers, circuit breaker, pricing.

All modules that need LLM calls should use the helpers from here
instead of raw SDK calls. This ensures every call gets:
- Circuit breaker (fail-fast after repeated errors)
- Daily cost limit enforcement
- Retry with exponential backoff
- Cost tracking and DB persistence
- Prompt caching on system prompts (Claude) / JSON mode (OpenAI)
- Request timeout (30s)
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from enum import Enum

import anthropic
import openai

from api.config import settings
from api.core.cost_tracker import cost_tracker
from api.core.llm_logging import fire_and_forget_persist
from api.core.llm_utils import strip_markdown_fencing

logger = logging.getLogger(__name__)


class LLMMode:
    """Labels for LLM call modes used in logging and persistence."""

    DECOMPOSE = "decompose"
    SOLVE = "solve"
    CONVERSE = "converse"
    STEP_CHAT = "step_chat"
    PRACTICE_GENERATE = "practice_generate"
    PRACTICE_EVAL = "practice_eval"
    GENERATE_SIMILAR = "generate_similar"
    IMAGE_EXTRACT = "image_extract"

_client: anthropic.AsyncAnthropic | None = None
_openai_client: openai.AsyncOpenAI | None = None

MODEL_SONNET = settings.llm_model_sonnet
MODEL_HAIKU = settings.llm_model_haiku
MODEL_GPT5 = settings.llm_model_gpt5
MODEL_CLASSIFY = MODEL_HAIKU
MODEL_REASON = MODEL_GPT5

# Pricing per token (USD)
_PRICING: dict[str, tuple[float, float]] = {
    MODEL_SONNET: (3.0 / 1_000_000, 15.0 / 1_000_000),
    MODEL_HAIKU: (0.80 / 1_000_000, 4.0 / 1_000_000),
    MODEL_GPT5: (1.25 / 1_000_000, 10.0 / 1_000_000),
}
# Fallback for unknown models
_DEFAULT_PRICING = _PRICING[MODEL_GPT5]

MAX_RETRIES = 3


def get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.claude_api_key)
    return _client


def get_openai_client() -> openai.AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


# ---------------------------------------------------------------------------
# Circuit breaker
# ---------------------------------------------------------------------------

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


@dataclass
class CircuitBreaker:
    failure_threshold: int = 5
    cooldown_seconds: float = 30.0
    _failure_count: int = field(default=0, init=False)
    _state: CircuitState = field(default=CircuitState.CLOSED, init=False)
    _last_failure_time: float = field(default=0.0, init=False)

    def record_success(self) -> None:
        self._failure_count = 0
        self._state = CircuitState.CLOSED

    def record_failure(self) -> None:
        self._failure_count += 1
        self._last_failure_time = time.monotonic()
        if self._failure_count >= self.failure_threshold:
            self._state = CircuitState.OPEN
            logger.warning("Circuit breaker OPEN after %d failures", self._failure_count)

    def allow_request(self) -> bool:
        if self._state == CircuitState.CLOSED:
            return True
        elapsed = time.monotonic() - self._last_failure_time
        if elapsed >= self.cooldown_seconds:
            self._state = CircuitState.HALF_OPEN
            return True
        return False

    def reset(self) -> None:
        """Reset to closed state. Used by tests."""
        self._failure_count = 0
        self._state = CircuitState.CLOSED
        self._last_failure_time = 0.0


_circuit = CircuitBreaker()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _calc_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    input_price, output_price = _PRICING.get(model, _DEFAULT_PRICING)
    return (input_tokens * input_price) + (output_tokens * output_price)


async def _log_and_persist(
    model: str,
    mode: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: float,
    session_id: str | None,
    user_id: str | None,
    success: bool = True,
    retry_count: int = 0,
    input_text: str | None = None,
    output_text: str | None = None,
) -> None:
    """Track cost, log, and persist an LLM call to the database."""
    cost = _calc_cost(model, input_tokens, output_tokens)
    await cost_tracker.add(cost)

    logger.info(
        "LLM call: mode=%s model=%s tokens=%d+%d cost=$%.4f latency=%.0fms",
        mode, model, input_tokens, output_tokens, cost, latency_ms,
        extra={
            "llm_mode": mode,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": round(cost, 6),
            "latency_ms": latency_ms,
            "session_id": session_id,
            "user_id": user_id,
        },
    )

    fire_and_forget_persist(
        model=model,
        function=mode,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        latency_ms=latency_ms,
        cost_usd=round(cost, 6),
        session_id=session_id,
        user_id=user_id,
        success=success,
        retry_count=retry_count,
        input_text=input_text,
        output_text=output_text,
    )


def _system_with_cache(
    prompt: str,
) -> list[anthropic.types.TextBlockParam]:
    """Wrap a system prompt with cache_control for Anthropic prompt caching."""
    return [
        {"type": "text", "text": prompt, "cache_control": {"type": "ephemeral"}},
    ]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def call_claude_json(
    system_prompt: str,
    user_message: str,
    mode: str,
    *,
    session_id: str | None = None,
    user_id: str | None = None,
    model: str | None = None,
    max_tokens: int = 512,
    max_retries: int = MAX_RETRIES,
) -> dict[str, object]:
    """Call Claude and parse the JSON response.

    All LLM JSON calls across the backend should use this function.
    It provides circuit breaker, cost limiting, retry with exponential
    backoff, prompt caching, timeout, and cost/call logging.

    Args:
        system_prompt: The system prompt.
        user_message: The user message text.
        mode: Label for logging/persistence (e.g. "decompose", "converse").
        session_id: Optional session ID for logging.
        user_id: Optional user ID for logging.
        model: Claude model to use. Defaults to MODEL_CLASSIFY (Haiku).
        max_tokens: Max tokens in response. Defaults to 512.
        max_retries: Number of retry attempts. Defaults to 3.
    """
    if not _circuit.allow_request():
        raise RuntimeError("Circuit breaker is open — Claude API temporarily unavailable")
    await cost_tracker.check_limit()

    use_model = model or MODEL_CLASSIFY
    client = get_client()
    last_error: Exception | None = None

    for attempt in range(max_retries):
        start = time.monotonic()
        try:
            response = await client.messages.create(
                model=use_model,
                max_tokens=max_tokens,
                system=_system_with_cache(system_prompt),
                messages=[{"role": "user", "content": user_message}],
                timeout=30.0,
            )
            latency_ms = round((time.monotonic() - start) * 1000, 2)
            first_block = response.content[0]
            if not hasattr(first_block, "text"):
                raise ValueError("Unexpected response type from Claude")
            resp_text = first_block.text
            await _log_and_persist(
                use_model, mode,
                response.usage.input_tokens, response.usage.output_tokens,
                latency_ms, session_id, user_id,
                success=True, retry_count=attempt,
                input_text=user_message, output_text=resp_text,
            )
            _circuit.record_success()

            # If response was truncated, don't retry — a longer response
            # will just hit the same token limit
            if response.stop_reason == "max_tokens":
                raise RuntimeError(
                    f"Response truncated (hit {max_tokens} token limit)"
                )

            text = strip_markdown_fencing(resp_text)
            result: dict[str, object] = json.loads(text)
            return result

        except (anthropic.APITimeoutError, anthropic.APIError) as e:
            latency_ms = round((time.monotonic() - start) * 1000, 2)
            last_error = e
            _circuit.record_failure()
            logger.warning("Claude API error (attempt %d): %s", attempt + 1, e)
            await _log_and_persist(
                use_model, mode, 0, 0, latency_ms, session_id, user_id,
                success=False, retry_count=attempt,
                input_text=user_message,
            )
        except json.JSONDecodeError as e:
            last_error = e
            logger.warning("JSON parse error (attempt %d): %s", attempt + 1, e)
            # Log actual tokens — the API call succeeded, tokens were consumed
            await _log_and_persist(
                use_model, mode,
                response.usage.input_tokens, response.usage.output_tokens,
                latency_ms, session_id, user_id,
                success=False, retry_count=attempt,
                input_text=user_message, output_text=resp_text,
            )

        if attempt < max_retries - 1:
            await asyncio.sleep(2**attempt)

    raise RuntimeError(f"Claude JSON call failed after {max_retries} retries: {last_error}")


async def call_openai_json(
    system_prompt: str,
    user_message: str,
    mode: str,
    *,
    session_id: str | None = None,
    user_id: str | None = None,
    model: str | None = None,
    max_tokens: int = 512,
    max_retries: int = MAX_RETRIES,
) -> dict[str, object]:
    """Call OpenAI and parse the JSON response.

    Mirror of call_claude_json with the same reliability features:
    circuit breaker, cost limiting, retry, timeout, and logging.
    """
    if not _circuit.allow_request():
        raise RuntimeError("Circuit breaker is open — LLM API temporarily unavailable")
    await cost_tracker.check_limit()

    use_model = model or MODEL_REASON
    client = get_openai_client()
    last_error: Exception | None = None

    for attempt in range(max_retries):
        start = time.monotonic()
        try:
            response = await client.chat.completions.create(
                model=use_model,
                max_completion_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                response_format={"type": "json_object"},
                timeout=30.0,
            )
            latency_ms = round((time.monotonic() - start) * 1000, 2)
            choice = response.choices[0]
            resp_text = choice.message.content or ""

            input_tokens = response.usage.prompt_tokens if response.usage else 0
            output_tokens = response.usage.completion_tokens if response.usage else 0

            await _log_and_persist(
                use_model, mode,
                input_tokens, output_tokens,
                latency_ms, session_id, user_id,
                success=True, retry_count=attempt,
                input_text=user_message, output_text=resp_text,
            )
            _circuit.record_success()

            if choice.finish_reason == "length":
                raise RuntimeError(
                    f"Response truncated (hit {max_tokens} token limit)"
                )

            text = strip_markdown_fencing(resp_text)
            result: dict[str, object] = json.loads(text)
            return result

        except (openai.APITimeoutError, openai.APIError) as e:
            latency_ms = round((time.monotonic() - start) * 1000, 2)
            last_error = e
            _circuit.record_failure()
            logger.warning("OpenAI API error (attempt %d): %s", attempt + 1, e)
            await _log_and_persist(
                use_model, mode, 0, 0, latency_ms, session_id, user_id,
                success=False, retry_count=attempt,
                input_text=user_message,
            )
        except json.JSONDecodeError as e:
            last_error = e
            logger.warning("JSON parse error (attempt %d): %s", attempt + 1, e)
            await _log_and_persist(
                use_model, mode,
                input_tokens, output_tokens,
                latency_ms, session_id, user_id,
                success=False, retry_count=attempt,
                input_text=user_message, output_text=resp_text,
            )

        if attempt < max_retries - 1:
            await asyncio.sleep(2**attempt)

    raise RuntimeError(f"OpenAI JSON call failed after {max_retries} retries: {last_error}")


async def call_openai_vision(
    image_base64: str,
    media_type: str,
    text_prompt: str,
    mode: str,
    *,
    session_id: str | None = None,
    user_id: str | None = None,
    model: str | None = None,
    max_tokens: int = 1024,
) -> dict[str, object]:
    """Call OpenAI with image content (Vision) and parse JSON response.

    Single-attempt (no retry) — the user can retry from the UI.
    """
    if not _circuit.allow_request():
        raise RuntimeError("Circuit breaker is open — LLM API temporarily unavailable")
    await cost_tracker.check_limit()

    use_model = model or MODEL_REASON
    client = get_openai_client()

    start = time.monotonic()
    try:
        response = await client.chat.completions.create(
            model=use_model,
            max_completion_tokens=max_tokens,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{media_type};base64,{image_base64}",
                            },
                        },
                        {
                            "type": "text",
                            "text": text_prompt,
                        },
                    ],
                },
            ],
            response_format={"type": "json_object"},
            timeout=30.0,
        )
        latency_ms = round((time.monotonic() - start) * 1000, 2)
        choice = response.choices[0]
        resp_text = choice.message.content or ""

        input_tokens = response.usage.prompt_tokens if response.usage else 0
        output_tokens = response.usage.completion_tokens if response.usage else 0

        await _log_and_persist(
            use_model, mode,
            input_tokens, output_tokens,
            latency_ms, session_id=session_id, user_id=user_id,
            success=True, retry_count=0,
            output_text=resp_text,
        )
        _circuit.record_success()

        text = strip_markdown_fencing(resp_text)
        result: dict[str, object] = json.loads(text)
        return result

    except (openai.APITimeoutError, openai.APIError) as e:
        latency_ms = round((time.monotonic() - start) * 1000, 2)
        _circuit.record_failure()
        await _log_and_persist(
            use_model, mode, 0, 0, latency_ms,
            session_id=session_id, user_id=user_id, success=False,
        )
        raise RuntimeError(f"OpenAI Vision API error: {e}") from e
    except (json.JSONDecodeError, ValueError) as e:
        raise RuntimeError(f"Failed to parse OpenAI Vision response: {e}") from e


