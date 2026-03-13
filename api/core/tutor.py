"""LLM Tutor Layer: converse and step-chat modes.

All calls use non-streaming JSON. Includes retry with exponential backoff,
circuit breaker, prompt caching, and per-call logging with token/cost tracking.

Cost optimizations:
- Haiku for classification/eval tasks
- Prompt caching via cache_control on static system prompts
- Trimmed conversation history (last 6 exchanges instead of 10)
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from enum import Enum

import anthropic

from api.config import settings
from api.core.cost_tracker import cost_tracker as _cost_tracker
from api.core.llm_client import get_client
from api.core.llm_logging import fire_and_forget_persist
from api.core.llm_utils import strip_markdown_fencing

logger = logging.getLogger(__name__)

MODEL_SONNET = settings.llm_model_sonnet
MODEL_HAIKU = settings.llm_model_haiku
# Haiku for simple classification/eval; Sonnet for reasoning-heavy tasks
MODEL_CLASSIFY = MODEL_HAIKU
MAX_RETRIES = 3
# Sonnet pricing
COST_PER_INPUT_TOKEN_SONNET = 3.0 / 1_000_000
COST_PER_OUTPUT_TOKEN_SONNET = 15.0 / 1_000_000
# Haiku pricing
COST_PER_INPUT_TOKEN_HAIKU = 0.80 / 1_000_000
COST_PER_OUTPUT_TOKEN_HAIKU = 4.0 / 1_000_000

_PRICING = {
    MODEL_SONNET: (COST_PER_INPUT_TOKEN_SONNET, COST_PER_OUTPUT_TOKEN_SONNET),
    MODEL_HAIKU: (COST_PER_INPUT_TOKEN_HAIKU, COST_PER_OUTPUT_TOKEN_HAIKU),
}

# Max recent exchanges sent to converse() — trimmed from 10 to 6
CONVERSE_HISTORY_LIMIT = 6


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


_circuit = CircuitBreaker()


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

CONVERSATIONAL_TUTOR_PROMPT = """\
You are a math tutor having a conversation with a student solving a problem step by step.

You will receive:
- The problem being solved
- The full list of solution steps (as an "answer key")
- The conversation history so far
- The student's latest input

Classify the student's input and respond accordingly:

1. **question**: The student is asking a question or requesting guidance.
   - Give a helpful hint WITHOUT revealing the answer.
   - Set is_correct to false, steps_completed to null.

2. **answer**: The student is attempting to give a mathematical answer.
   - Compare against the solution steps. Accept mathematically equivalent forms.
   - If correct, set is_correct to true, steps_completed to the index (0-based) of the furthest step they've completed.
   - If wrong, set is_correct to false, steps_completed to null, and give encouraging feedback.

3. **unclear**: The input doesn't clearly fit either category.
   - Ask the student to clarify.
   - Set is_correct to false, steps_completed to null.

Respond with ONLY valid JSON:
{
  "input_type": "question" | "answer" | "unclear",
  "is_correct": true/false,
  "steps_completed": <int or null>,
  "feedback": "Your response to the student"
}

Rules:
- NEVER reveal the final answer
- NEVER reveal the exact result of a step the student hasn't completed
- Be encouraging and guide the student toward understanding
- Accept mathematically equivalent answers (e.g., 2/4 and 1/2 are the same)
- For correct answers that match multiple steps, set steps_completed to the furthest matching step index
- Keep feedback concise (1-3 sentences)
- For CORRECT answers: just confirm ("Correct!", "Nice work!"). Do NOT ask
  the student to explain the step or prompt for the next step — the app
  handles navigation automatically."""

# ---------------------------------------------------------------------------
# Response types
# ---------------------------------------------------------------------------


@dataclass
class ConverseResult:
    input_type: str  # "question" | "answer" | "unclear"
    is_correct: bool
    steps_completed: int | None
    feedback: str


@dataclass
class LLMCallLog:
    mode: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    latency_ms: float
    session_id: str | None = None
    user_id: str | None = None


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _log_llm_call(
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
    """Log an LLM call, track cost, and persist to database."""
    input_price, output_price = _PRICING.get(
        model, (COST_PER_INPUT_TOKEN_SONNET, COST_PER_OUTPUT_TOKEN_SONNET)
    )
    cost = (input_tokens * input_price) + (output_tokens * output_price)
    _cost_tracker.add(cost)

    log = LLMCallLog(
        mode=mode,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=round(cost, 6),
        latency_ms=latency_ms,
        session_id=session_id,
        user_id=user_id,
    )
    logger.info(
        "LLM call: mode=%s model=%s tokens=%d+%d cost=$%.4f latency=%.0fms",
        log.mode, model, log.input_tokens, log.output_tokens,
        log.cost_usd, log.latency_ms,
        extra={
            "llm_mode": log.mode,
            "model": model,
            "input_tokens": log.input_tokens,
            "output_tokens": log.output_tokens,
            "cost_usd": log.cost_usd,
            "latency_ms": log.latency_ms,
            "session_id": log.session_id,
            "user_id": log.user_id,
        },
    )

    # Persist to database (fire-and-forget)
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
# Core LLM calls
# ---------------------------------------------------------------------------

async def _call_claude_json(
    system_prompt: str,
    user_message: str,
    mode: str,
    session_id: str | None = None,
    user_id: str | None = None,
    model: str | None = None,
) -> dict[str, object]:
    """Call Claude non-streaming and parse the response as JSON.

    Uses messages.create() directly instead of streaming, which is
    faster and lower-overhead for structured JSON responses.
    Defaults to MODEL_CLASSIFY (Haiku) for cost efficiency.
    """
    if not _circuit.allow_request():
        raise RuntimeError("Circuit breaker is open — Claude API temporarily unavailable")
    _cost_tracker.check_limit()

    use_model = model or MODEL_CLASSIFY
    client = get_client()
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES):
        start = time.monotonic()
        try:
            response = await client.messages.create(
                model=use_model,
                max_tokens=512,
                system=_system_with_cache(system_prompt),
                messages=[{"role": "user", "content": user_message}],
                timeout=30.0,
            )
            latency_ms = round((time.monotonic() - start) * 1000, 2)
            first_block = response.content[0]
            if not hasattr(first_block, "text"):
                raise ValueError("Unexpected response type from Claude")
            resp_text = first_block.text
            _log_llm_call(
                use_model, mode,
                response.usage.input_tokens, response.usage.output_tokens,
                latency_ms, session_id, user_id,
                success=True, retry_count=attempt,
                input_text=user_message, output_text=resp_text,
            )
            _circuit.record_success()

            text = strip_markdown_fencing(resp_text)
            result: dict[str, object] = json.loads(text)
            return result

        except (anthropic.APITimeoutError, anthropic.APIError) as e:
            last_error = e
            _circuit.record_failure()
            logger.warning("Claude API error (attempt %d): %s", attempt + 1, e)
        except json.JSONDecodeError as e:
            last_error = e
            logger.warning("JSON parse error (attempt %d): %s", attempt + 1, e)

        if attempt < MAX_RETRIES - 1:
            await asyncio.sleep(2**attempt)

    raise RuntimeError(f"Claude JSON call failed after {MAX_RETRIES} retries: {last_error}")


# ---------------------------------------------------------------------------
# Public API: tutor modes
# ---------------------------------------------------------------------------

async def converse(
    problem: str,
    steps: list[dict[str, str]],
    exchanges: list[dict[str, str]],
    student_input: str,
    session_id: str | None = None,
    user_id: str | None = None,
) -> ConverseResult:
    """Evaluate a student's free-form input against the full problem context."""
    steps_text = "\n".join(
        f"  Step {i}: {s['description']} | {s['before']} → {s['after']}"
        for i, s in enumerate(steps)
    )
    history_text = "\n".join(
        f"  {e['role']}: {e['content']}"
        for e in exchanges[-CONVERSE_HISTORY_LIMIT:]
    ) if exchanges else "(no prior conversation)"

    prompt = (
        f"Problem: {problem}\n\n"
        f"Solution steps (answer key):\n{steps_text}\n\n"
        f"Conversation so far:\n{history_text}\n\n"
        f"Student's latest input: {student_input}"
    )
    data = await _call_claude_json(
        CONVERSATIONAL_TUTOR_PROMPT, prompt, "converse", session_id, user_id
    )
    return ConverseResult(
        input_type=str(data.get("input_type", "unclear")),
        is_correct=bool(data.get("is_correct", False)),
        steps_completed=int(str(data["steps_completed"])) if data.get("steps_completed") is not None else None,
        feedback=str(data.get("feedback", "")),
    )


STEP_CHAT_PROMPT = """\
You are a math tutor helping a student understand a specific step in solving a problem.

You will receive:
- The problem being solved
- The current step the student is looking at (description, before, after)
- The conversation history so far
- The student's question

Your job is to help the student understand THIS SPECIFIC STEP only.
Do NOT reveal future steps or the final answer.

Respond with ONLY valid JSON:
{
  "feedback": "Your helpful response to the student's question"
}

Rules:
- Answer questions about WHY this step is done and HOW it works
- Use concrete examples and analogies if helpful
- Keep responses concise (2-4 sentences)
- NEVER reveal the final answer to the problem
- NEVER skip ahead to future steps — only discuss the current step
- If the student asks about something unrelated to this step, gently redirect"""


@dataclass
class StepChatResult:
    feedback: str


async def step_chat(
    problem: str,
    step: dict[str, str],
    exchanges: list[dict[str, str]],
    student_input: str,
    session_id: str | None = None,
    user_id: str | None = None,
) -> StepChatResult:
    """Answer a student's question about a specific step."""
    history_text = "\n".join(
        f"  {e['role']}: {e['content']}"
        for e in exchanges[-CONVERSE_HISTORY_LIMIT:]
    ) if exchanges else "(no prior conversation)"

    prompt = (
        f"Problem: {problem}\n\n"
        f"Current step:\n"
        f"  Description: {step['description']}\n"
        f"  Before: {step['before']}\n"
        f"  After: {step['after']}\n\n"
        f"Conversation so far:\n{history_text}\n\n"
        f"Student's question: {student_input}"
    )
    data = await _call_claude_json(
        STEP_CHAT_PROMPT, prompt, "step_chat", session_id, user_id
    )
    return StepChatResult(feedback=str(data.get("feedback", "")))


def get_daily_cost() -> float:
    """Return the current day's total estimated Claude API cost."""
    return _cost_tracker.total_usd
