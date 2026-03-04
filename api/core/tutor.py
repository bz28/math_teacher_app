"""LLM Tutor Layer: evaluator, explainer, and prober modes.

Each mode uses the same Claude model with different system prompts.
All responses are streamed. Includes retry with exponential backoff,
circuit breaker, and per-call logging with token/cost tracking.
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from enum import Enum

import anthropic

from api.config import settings

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-20250514"
MAX_RETRIES = 3
BASE_TIMEOUT = 10.0  # seconds
COST_PER_INPUT_TOKEN = 3.0 / 1_000_000  # $3 per 1M input tokens (Sonnet)
COST_PER_OUTPUT_TOKEN = 15.0 / 1_000_000  # $15 per 1M output tokens


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
# Daily cost tracker
# ---------------------------------------------------------------------------

@dataclass
class CostTracker:
    _total_usd: float = field(default=0.0, init=False)
    _reset_day: int = field(default=0, init=False)

    def _maybe_reset(self) -> None:
        import datetime
        today = datetime.date.today().toordinal()
        if today != self._reset_day:
            self._total_usd = 0.0
            self._reset_day = today

    def add(self, amount: float) -> None:
        self._maybe_reset()
        self._total_usd += amount
        if self._total_usd >= settings.daily_cost_limit_usd:
            logger.error(
                "Daily cost limit exceeded: $%.2f >= $%.2f",
                self._total_usd,
                settings.daily_cost_limit_usd,
            )

    @property
    def total_usd(self) -> float:
        self._maybe_reset()
        return self._total_usd


_cost_tracker = CostTracker()


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

EVALUATOR_PROMPT = """You are a math tutor evaluating a student's response to a step in solving a problem.

You will receive full context about the current step:
- The problem being solved
- The current expression (what the student is starting from)
- The expected operation (what they should do)
- The expected result (what the expression becomes after the operation)
- The student's response

The student's response may be:
1. A description of an operation (e.g., "add 12 to both sides")
2. A mathematical result (e.g., "6x = 16")
3. A mix of both (e.g., "add 12 to get 6x = 16")

Respond with ONLY valid JSON:
{
  "is_correct": true/false,
  "feedback": "Brief feedback explaining why correct or what went wrong"
}

Rules:
- If the student describes an operation: check if it matches the expected operation and would produce the correct result
- If the student gives a result: check if it's mathematically equivalent to the expected result
- Accept mathematically equivalent answers (e.g., 2/4 and 1/2 are the same)
- If the student describes the WRONG operation (e.g., "subtract" when they should
  "add"), mark incorrect and explain what they should do instead. Never give the answer
- If partially correct (right approach, arithmetic error), acknowledge the approach
- Keep feedback concise (1-2 sentences)
- Be encouraging but honest
- NEVER reveal the correct answer or the next step in your feedback
- For "translate" or "set up equation" steps, accept equivalent equation formulations
  (e.g., "d = 60*3" and "60*3 = d" are both correct)"""

EXPLAINER_PROMPT = """You are a math tutor explaining a concept to a student.

Given:
- The step being worked on
- What went wrong (if applicable)
- The student's grade level

Rules:
- Calibrate language to the grade level
- Use concrete examples and analogies appropriate for the age
- Keep explanations clear and concise (2-4 sentences)
- Focus on WHY, not just WHAT
- Never give away the full answer — guide the student toward understanding
- Use standard math notation (e.g., x^2 not x²)"""

PROBER_PROMPT = """You are a math tutor assessing whether a student truly understands a step.

Given:
- The math step that was completed
- The student's explanation in their own words

Respond with ONLY valid JSON:
{
  "understanding": "clear" | "partial" | "wrong",
  "follow_up": "A follow-up question or null if understanding is clear"
}

Rubric:
- "clear": Student identifies the operation AND explains WHY it applies
- "partial": Student describes WHAT happened but not WHY
- "wrong": Student's explanation contradicts the step or is incoherent

Rules:
- Be generous with "clear" — students don't need textbook-perfect language
- For "partial", ask a targeted question to draw out the WHY
- Keep follow_up questions short and specific"""


# ---------------------------------------------------------------------------
# Response types
# ---------------------------------------------------------------------------

@dataclass
class EvalResult:
    is_correct: bool
    feedback: str


@dataclass
class ProbeResult:
    understanding: str  # "clear" | "partial" | "wrong"
    follow_up: str | None


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
# Core LLM call with retry + streaming
# ---------------------------------------------------------------------------

async def _call_claude_stream(
    system_prompt: str,
    user_message: str,
    mode: str,
    session_id: str | None = None,
    user_id: str | None = None,
) -> AsyncIterator[str]:
    """Stream a Claude response with retry and circuit breaker."""
    if not _circuit.allow_request():
        raise RuntimeError("Circuit breaker is open — Claude API temporarily unavailable")

    client = anthropic.AsyncAnthropic(api_key=settings.claude_api_key)
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES):
        start = time.monotonic()
        try:
            async with client.messages.stream(
                model=MODEL,
                max_tokens=512,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            ) as stream:
                async for text in stream.text_stream:
                    yield text

                # Log after stream completes
                response = await stream.get_final_message()
                latency_ms = round((time.monotonic() - start) * 1000, 2)
                input_tokens = response.usage.input_tokens
                output_tokens = response.usage.output_tokens
                cost = (input_tokens * COST_PER_INPUT_TOKEN) + (output_tokens * COST_PER_OUTPUT_TOKEN)
                _cost_tracker.add(cost)
                _circuit.record_success()

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
                    "LLM call: mode=%s tokens=%d+%d cost=$%.4f latency=%.0fms",
                    log.mode, log.input_tokens, log.output_tokens,
                    log.cost_usd, log.latency_ms,
                    extra={
                        "llm_mode": log.mode,
                        "input_tokens": log.input_tokens,
                        "output_tokens": log.output_tokens,
                        "cost_usd": log.cost_usd,
                        "latency_ms": log.latency_ms,
                        "session_id": log.session_id,
                        "user_id": log.user_id,
                    },
                )
                return  # Success — exit retry loop

        except anthropic.APITimeoutError as e:
            last_error = e
            _circuit.record_failure()
            logger.warning("Claude timeout (attempt %d): %s", attempt + 1, e)
        except anthropic.APIError as e:
            last_error = e
            _circuit.record_failure()
            logger.warning("Claude API error (attempt %d): %s", attempt + 1, e)

        # Exponential backoff
        if attempt < MAX_RETRIES - 1:
            await asyncio.sleep(2**attempt)

    raise RuntimeError(f"Claude API failed after {MAX_RETRIES} retries: {last_error}")


async def _call_claude_json(
    system_prompt: str,
    user_message: str,
    mode: str,
    session_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, object]:
    """Call Claude and parse the full response as JSON (non-streaming)."""
    chunks: list[str] = []
    async for chunk in _call_claude_stream(system_prompt, user_message, mode, session_id, user_id):
        chunks.append(chunk)

    text = "".join(chunks).strip()
    # Strip markdown fencing
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    result: dict[str, object] = json.loads(text)
    return result


# ---------------------------------------------------------------------------
# Public API: three tutor modes
# ---------------------------------------------------------------------------

async def evaluate(
    problem: str,
    step_before: str,
    step_operation: str,
    step_after: str,
    student_response: str,
    session_id: str | None = None,
    user_id: str | None = None,
) -> EvalResult:
    """Evaluate a student's response against the correct step."""
    prompt = (
        f"Problem: {problem}\n"
        f"Current expression: {step_before}\n"
        f"Expected operation: {step_operation}\n"
        f"Expected result: {step_after}\n"
        f"Student's response: {student_response}"
    )
    data = await _call_claude_json(EVALUATOR_PROMPT, prompt, "evaluator", session_id, user_id)
    return EvalResult(is_correct=bool(data["is_correct"]), feedback=str(data["feedback"]))


async def explain(
    step: str,
    error: str | None,
    grade_level: int,
    session_id: str | None = None,
    user_id: str | None = None,
) -> AsyncIterator[str]:
    """Stream an explanation for a step (optionally addressing an error)."""
    parts = [f"Step: {step}", f"Grade level: {grade_level}"]
    if error:
        parts.append(f"Student's error: {error}")
    prompt = "\n".join(parts)

    async for chunk in _call_claude_stream(EXPLAINER_PROMPT, prompt, "explainer", session_id, user_id):
        yield chunk


async def probe(
    step: str,
    student_explanation: str,
    session_id: str | None = None,
    user_id: str | None = None,
) -> ProbeResult:
    """Assess a student's own-words explanation of a step."""
    prompt = (
        f"Math step: {step}\n"
        f"Student's explanation: {student_explanation}"
    )
    data = await _call_claude_json(PROBER_PROMPT, prompt, "prober", session_id, user_id)
    return ProbeResult(
        understanding=str(data["understanding"]),
        follow_up=str(data["follow_up"]) if data.get("follow_up") else None,
    )


def get_daily_cost() -> float:
    """Return the current day's total estimated Claude API cost."""
    return _cost_tracker.total_usd
