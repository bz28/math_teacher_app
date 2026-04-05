"""Shared LLM client: singleton, call helpers, circuit breaker, pricing.

All modules that call Claude should use call_claude_json() from here
instead of raw client.messages.create(). This ensures every call gets:
- Circuit breaker (fail-fast after repeated errors)
- Daily cost limit enforcement
- Retry with exponential backoff
- Cost tracking and DB persistence
- Prompt caching on system prompts
- Request timeout (30s)
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import anthropic
from anthropic.types import ToolChoiceToolParam, ToolParam

from api.config import settings
from api.core.cost_tracker import cost_tracker
from api.core.llm_logging import fire_and_forget_persist
from api.core.llm_schemas import ToolSchema

logger = logging.getLogger(__name__)


class LLMMode:
    """Labels for LLM call modes used in logging and persistence."""

    DECOMPOSE = "decompose"
    DECOMPOSE_DIAGNOSIS = "decompose_diagnosis"
    STEP_CHAT = "step_chat"
    PRACTICE_GENERATE = "practice_generate"
    PRACTICE_EVAL = "practice_eval"
    IMAGE_EXTRACT = "image_extract"
    DIAGNOSE_WORK = "diagnose_work"
    JUDGE = "judge"
    SUGGEST_UNITS = "suggest_units"
    GENERATE_QUESTIONS = "generate_questions"

_client: anthropic.AsyncAnthropic | None = None

MODEL_SONNET = settings.llm_model_sonnet
MODEL_HAIKU = settings.llm_model_haiku
MODEL_CLASSIFY = MODEL_HAIKU
MODEL_REASON = MODEL_SONNET

# Pricing per token (USD)
_PRICING: dict[str, tuple[float, float]] = {
    MODEL_SONNET: (3.0 / 1_000_000, 15.0 / 1_000_000),
    MODEL_HAIKU: (0.80 / 1_000_000, 4.0 / 1_000_000),
}
# Fallback for unknown models
_DEFAULT_PRICING = _PRICING[MODEL_SONNET]

MAX_RETRIES = 3


def get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.claude_api_key)
    return _client


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


def _to_tool_params(schema: ToolSchema) -> tuple[list[ToolParam], ToolChoiceToolParam]:
    """Convert a ToolSchema dict to typed SDK params."""
    tool: ToolParam = {
        "name": schema["name"],
        "input_schema": schema["input_schema"],
        "description": schema.get("description", ""),
    }
    choice: ToolChoiceToolParam = {"type": "tool", "name": schema["name"]}
    return [tool], choice


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def call_claude_json(
    system_prompt: str,
    user_message: str,
    mode: str,
    *,
    tool_schema: ToolSchema,
    session_id: str | None = None,
    user_id: str | None = None,
    model: str | None = None,
    max_tokens: int = 512,
    max_retries: int = MAX_RETRIES,
) -> dict[str, object]:
    """Call Claude and return a structured JSON dict via tool use.

    All LLM JSON calls across the backend should use this function.
    It provides circuit breaker, cost limiting, retry with exponential
    backoff, prompt caching, timeout, and cost/call logging.

    Uses Anthropic tool use — the API returns properly serialized JSON
    with no parsing issues (no LaTeX backslash escaping, no markdown
    fencing, no manual JSON parsing needed).

    Args:
        system_prompt: The system prompt.
        user_message: The user message text.
        mode: Label for logging/persistence (e.g. "decompose", "converse").
        tool_schema: Anthropic tool definition for structured output.
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
    tools, tool_choice = _to_tool_params(tool_schema)

    for attempt in range(max_retries):
        start = time.monotonic()
        try:
            response = await client.messages.create(
                model=use_model,
                max_tokens=max_tokens,
                system=_system_with_cache(system_prompt),
                messages=[{"role": "user", "content": user_message}],
                tools=tools,
                tool_choice=tool_choice,
                timeout=90.0,
            )
            latency_ms = round((time.monotonic() - start) * 1000, 2)

            # Tool use can be truncated if the response hits max_tokens
            if response.stop_reason == "end_turn":
                result, resp_text = _extract_tool_result(response)
            else:
                raise ValueError(
                    f"Unexpected stop_reason '{response.stop_reason}' "
                    f"(expected 'end_turn', may be truncated at {max_tokens} tokens)"
                )

            await _log_and_persist(
                use_model, mode,
                response.usage.input_tokens, response.usage.output_tokens,
                latency_ms, session_id, user_id,
                success=True, retry_count=attempt,
                input_text=user_message, output_text=resp_text,
            )
            _circuit.record_success()
            return result

        except (anthropic.APITimeoutError, anthropic.APIError) as e:
            latency_ms = round((time.monotonic() - start) * 1000, 2)
            last_error = e
            _circuit.record_failure()
            logger.warning("Claude API error (attempt %d): %s", attempt + 1, e)
            await _log_and_persist(
                use_model, mode, 0, 0, latency_ms, session_id, user_id,
                success=False, retry_count=attempt,
                input_text=user_message, output_text=str(e),
            )
        except ValueError as e:
            latency_ms = round((time.monotonic() - start) * 1000, 2)
            last_error = e
            logger.warning("Tool use extraction error (attempt %d): %s", attempt + 1, e)
            await _log_and_persist(
                use_model, mode,
                response.usage.input_tokens, response.usage.output_tokens,
                latency_ms, session_id, user_id,
                success=False, retry_count=attempt,
                input_text=user_message, output_text=str(e),
            )

        if attempt < max_retries - 1:
            await asyncio.sleep(2**attempt)

    raise RuntimeError(f"Claude JSON call failed after {max_retries} retries: {last_error}")


def _extract_tool_result(response: anthropic.types.Message) -> tuple[dict[str, object], str]:
    """Extract the tool_use result from a response.

    Returns (parsed_dict, text_for_logging).
    """
    for block in response.content:
        if block.type == "tool_use":
            result = block.input
            return result, json.dumps(result, ensure_ascii=False)
    raise ValueError("No tool_use block in response")


async def call_claude_vision(
    user_content: list[Any],
    mode: str,
    *,
    tool_schema: ToolSchema,
    session_id: str | None = None,
    user_id: str | None = None,
    model: str | None = None,
    max_tokens: int = 1024,
) -> dict[str, object]:
    """Call Claude with image content (Vision) and return structured JSON via tool use.

    Single-attempt (no retry) — the user can retry from the UI.
    Still gets circuit breaker, cost limiting, timeout, and logging.
    """
    if not _circuit.allow_request():
        raise RuntimeError("Circuit breaker is open — Claude API temporarily unavailable")
    await cost_tracker.check_limit()

    use_model = model or MODEL_REASON
    client = get_client()
    tools, tool_choice = _to_tool_params(tool_schema)

    start = time.monotonic()
    try:
        response = await client.messages.create(
            model=use_model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": user_content}],
            tools=tools,
            tool_choice=tool_choice,
            timeout=90.0,
        )
        latency_ms = round((time.monotonic() - start) * 1000, 2)

        if response.stop_reason != "end_turn":
            raise ValueError(
                f"Unexpected stop_reason '{response.stop_reason}' "
                f"(expected 'end_turn', may be truncated at {max_tokens} tokens)"
            )
        result, resp_text = _extract_tool_result(response)

        # Build a text summary of the input for logging (images replaced with placeholder)
        input_parts: list[str] = []
        for block in user_content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    input_parts.append(str(block["text"]))
                elif block.get("type") == "image":
                    input_parts.append("[image]")
            else:
                input_parts.append(str(block))
        input_summary = "\n".join(input_parts) if input_parts else None

        await _log_and_persist(
            use_model, mode,
            response.usage.input_tokens, response.usage.output_tokens,
            latency_ms, session_id=session_id, user_id=user_id,
            success=True, retry_count=0,
            input_text=input_summary, output_text=resp_text,
        )
        _circuit.record_success()
        return result

    except (anthropic.APITimeoutError, anthropic.APIError) as e:
        latency_ms = round((time.monotonic() - start) * 1000, 2)
        _circuit.record_failure()
        await _log_and_persist(
            use_model, mode, 0, 0, latency_ms,
            session_id=session_id, user_id=user_id, success=False,
        )
        raise RuntimeError(f"Claude Vision API error: {e}") from e
    except ValueError as e:
        raise RuntimeError(f"Failed to parse Claude Vision response: {e}") from e
