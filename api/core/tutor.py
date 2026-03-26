"""LLM Tutor Layer: step-chat and answer checking modes.

All calls use call_claude_json from llm_client for consistent retry,
circuit breaker, cost tracking, and logging.

Cost optimizations:
- Haiku for classification/eval tasks
- Prompt caching via cache_control on static system prompts
- Trimmed conversation history (last 6 exchanges instead of 10)
"""

import json
import logging
from dataclasses import dataclass

import anthropic

from api.core.llm_client import MODEL_CLASSIFY, LLMMode, call_claude_json
from api.core.subjects import Subject, get_config

# Max recent exchanges sent to chat functions
_HISTORY_LIMIT = 6

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

_STEP_CHAT_TEMPLATE = """\
You are a {tutor_role} helping a student understand a specific step in solving a problem.

You will receive:
- The problem being solved
- The current step description
- The conversation history so far
- The student's question

Your job is to help the student understand THIS SPECIFIC STEP only.
Do NOT reveal future steps or the final answer.

Respond with ONLY valid JSON:
{{
  "feedback": "Your helpful response to the student's question"
}}

Rules:
- Answer questions about WHY this step is done and HOW it works
- Use concrete examples and analogies if helpful
- Keep responses concise (2-4 sentences)
- NEVER reveal the final answer to the problem
- NEVER skip ahead to future steps — only discuss the current step
- If the student asks about something unrelated to this step, gently redirect"""

_COMPLETED_CHAT_TEMPLATE = """\
You are a {tutor_role}. The student has already solved the problem correctly and
is now asking follow-up questions to deepen their understanding.

You will receive:
- The problem and its solution steps
- The conversation history
- The student's question

Respond with ONLY valid JSON:
{{"feedback": "Your helpful response"}}

Rules:
- Answer clearly and concisely (1-3 sentences)
- You may freely reference any step or the final answer since the problem is solved
- If the student asks something unrelated to the problem, gently redirect"""

_ANSWER_EQUIVALENCE_TEMPLATE = """You are a strict {tutor_role} checking a student's final answer.

Determine if the student's answer is {equivalence_adjective} EQUIVALENT to the correct
final answer. Allow differences in formatting or notation (e.g., "x=3" vs
"x = 3", "6" vs "x = 6"), but the answer must be completely correct.

Be STRICT:
{equivalence_examples}

Respond with ONLY valid JSON:
{{"is_correct": <true/false>}}"""


def _build_step_chat_prompt(subject: str) -> str:
    cfg = get_config(subject)
    return _STEP_CHAT_TEMPLATE.format(tutor_role=cfg["tutor_role"])


def _build_completed_chat_prompt(subject: str) -> str:
    cfg = get_config(subject)
    return _COMPLETED_CHAT_TEMPLATE.format(tutor_role=cfg["tutor_role"])


def _build_equivalence_prompt(subject: str) -> str:
    cfg = get_config(subject)
    return _ANSWER_EQUIVALENCE_TEMPLATE.format(
        tutor_role=cfg["tutor_role"],
        equivalence_adjective=cfg["equivalence_adjective"],
        equivalence_examples=cfg["equivalence_examples"],
    )


# ---------------------------------------------------------------------------
# Response types
# ---------------------------------------------------------------------------

@dataclass
class StepChatResult:
    feedback: str


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def step_chat(
    problem: str,
    step: dict[str, str],
    exchanges: list[dict[str, str]],
    student_input: str,
    session_id: str | None = None,
    user_id: str | None = None,
    subject: str = Subject.MATH,
) -> StepChatResult:
    """Answer a student's question about a specific step."""
    history_text = "\n".join(
        f"  {e['role']}: {e['content']}"
        for e in exchanges[-_HISTORY_LIMIT:]
    ) if exchanges else "(no prior conversation)"

    prompt = (
        f"Problem: {problem}\n\n"
        f"Current step: {step['description']}\n\n"
        f"Conversation so far:\n{history_text}\n\n"
        f"Student's question: {student_input}"
    )
    data = await call_claude_json(
        _build_step_chat_prompt(subject), prompt, LLMMode.STEP_CHAT,
        session_id=session_id, user_id=user_id, model=MODEL_CLASSIFY,
    )
    return StepChatResult(feedback=str(data.get("feedback", "")))


async def completed_chat(
    problem: str,
    steps: list[dict[str, str]],
    exchanges: list[dict[str, str]],
    student_input: str,
    session_id: str | None = None,
    user_id: str | None = None,
    subject: str = Subject.MATH,
) -> StepChatResult:
    """Answer follow-up questions on a completed problem. Uses Haiku for cost."""
    steps_text = "\n".join(
        f"  Step {i}: {s['description']}"
        for i, s in enumerate(steps)
    )
    history_text = "\n".join(
        f"  {e['role']}: {e['content']}"
        for e in exchanges[-_HISTORY_LIMIT:]
    ) if exchanges else "(no prior conversation)"

    prompt = (
        f"Problem: {problem}\n\n"
        f"Solution steps:\n{steps_text}\n\n"
        f"Conversation so far:\n{history_text}\n\n"
        f"Student's question: {student_input}"
    )
    data = await call_claude_json(
        _build_completed_chat_prompt(subject), prompt, LLMMode.STEP_CHAT,
        session_id=session_id, user_id=user_id, model=MODEL_CLASSIFY,
    )
    return StepChatResult(feedback=str(data.get("feedback", "")))


async def check_answer_equivalence(
    problem: str,
    correct_answer: str,
    student_response: str,
    session_id: str | None = None,
    *,
    user_id: str | None = None,
    subject: str = Subject.MATH,
) -> bool:
    """Check if a student's answer is equivalent to the correct answer."""
    user_msg = (
        f"Problem: {problem}\n"
        f"Correct final answer: {correct_answer}\n"
        f"Student's answer: {student_response}"
    )
    try:
        result = await call_claude_json(
            _build_equivalence_prompt(subject), user_msg,
            mode=LLMMode.PRACTICE_EVAL, session_id=session_id, user_id=user_id,
        )
        return bool(result.get("is_correct", False))
    except (anthropic.APIError, anthropic.APITimeoutError, json.JSONDecodeError, RuntimeError):
        logger.exception("Answer equivalence check failed")
        return False
