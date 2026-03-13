"""LLM Tutor Layer: converse, step-chat, and answer checking modes.

All calls use call_claude_json from llm_client for consistent retry,
circuit breaker, cost tracking, and logging.

Cost optimizations:
- Haiku for classification/eval tasks
- Prompt caching via cache_control on static system prompts
- Trimmed conversation history (last 6 exchanges instead of 10)
"""

from dataclasses import dataclass

from api.core.llm_client import MODEL_REASON, call_claude_json

# Max recent exchanges sent to converse() — trimmed from 10 to 6
CONVERSE_HISTORY_LIMIT = 6


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

_ANSWER_EQUIVALENCE_PROMPT = """You are a strict math tutor checking a student's final answer.

Determine if the student's answer is MATHEMATICALLY EQUIVALENT to the correct
final answer. Allow differences in formatting or notation (e.g., "x=3" vs
"x = 3", "6" vs "x = 6"), but the answer must be completely correct.

Be STRICT:
- "35" does NOT match "35x^4" — the variable/exponent is missing
- Partial answers or answers missing terms are WRONG

Respond with ONLY valid JSON:
{"is_correct": <true/false>}"""


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
class StepChatResult:
    feedback: str


# ---------------------------------------------------------------------------
# Public API
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
    data = await call_claude_json(
        CONVERSATIONAL_TUTOR_PROMPT, prompt, "converse",
        session_id=session_id, user_id=user_id, model=MODEL_REASON,
    )
    return ConverseResult(
        input_type=str(data.get("input_type", "unclear")),
        is_correct=bool(data.get("is_correct", False)),
        steps_completed=int(str(data["steps_completed"])) if data.get("steps_completed") is not None else None,
        feedback=str(data.get("feedback", "")),
    )


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
    data = await call_claude_json(
        STEP_CHAT_PROMPT, prompt, "step_chat",
        session_id=session_id, user_id=user_id, model=MODEL_REASON,
    )
    return StepChatResult(feedback=str(data.get("feedback", "")))


async def check_answer_equivalence(
    problem: str,
    correct_answer: str,
    student_response: str,
    session_id: str | None = None,
) -> bool:
    """Check if a student's answer is mathematically equivalent to the correct answer."""
    user_msg = (
        f"Problem: {problem}\n"
        f"Correct final answer: {correct_answer}\n"
        f"Student's answer: {student_response}"
    )
    try:
        result = await call_claude_json(
            _ANSWER_EQUIVALENCE_PROMPT, user_msg,
            mode="practice_eval", session_id=session_id,
        )
        return bool(result.get("is_correct", False))
    except Exception:
        return False
