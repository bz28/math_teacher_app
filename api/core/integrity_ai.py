"""AI helpers for the conversational integrity checker.

Two surfaces:
- `extract_student_work`: one-time Vision pass over the submitted
  image (unchanged from the previous pipeline — still works, still
  gates unreadable submissions).
- `run_agent_turn`: one round trip with Claude as a teacher-agent.
  Gets the system prompt, the per-problem extraction snapshot, and
  the full conversation transcript so far; returns the raw response
  content blocks so the caller can process text + tool calls and
  decide whether to loop again with a tool_result.
"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.llm_client import (
    MODEL_REASON,
    LLMMode,
    call_claude_conversation,
    call_claude_vision,
)
from api.core.llm_schemas import (
    INTEGRITY_EXTRACT_SCHEMA,
    INTEGRITY_FINISH_CHECK_SCHEMA,
    INTEGRITY_GENERATE_VARIANT_SCHEMA,
    INTEGRITY_SUBMIT_VERDICT_SCHEMA,
)
from api.models.assignment import Submission

logger = logging.getLogger(__name__)

# Below this confidence threshold the handwriting is considered
# unreadable and the check is skipped.
UNREADABLE_THRESHOLD = 0.3

# Max tokens per agent turn. Keeps the agent terse and caps per-turn
# cost regardless of how chatty the model wants to be.
AGENT_MAX_TOKENS_PER_TURN = 400


def _strip_data_url_prefix(data: str) -> tuple[str, str]:
    """Strip the data URL prefix and return (base64, media_type).

    Handles:
    - "data:image/png;base64,iVBOR..."  → ("iVBOR...", "image/png")
    - "iVBOR..." (raw base64, PNG)      → ("iVBOR...", "image/png")
    - "/9j/..." (raw base64, JPEG)      → ("/9j/...", "image/jpeg")
    """
    m = re.match(r"^data:(image/(?:png|jpeg|jpg));base64,", data)
    if m:
        media_type = m.group(1)
        if media_type == "image/jpg":
            media_type = "image/jpeg"
        return data[m.end():], media_type
    if data.startswith("iVBOR"):
        return data, "image/png"
    return data, "image/jpeg"


# ── Extraction ──────────────────────────────────────────────────────

_EXTRACT_SYSTEM = """\
You are a world-class math professor examining a student's handwritten homework submission. \
Your task is to extract the student's work steps from the image into structured data.

Rules:
- List every distinct step the student wrote, in order from top to bottom.
- For each step, provide both the LaTeX representation and a plain-English description.
- If the handwriting is illegible or the image is blurry, set confidence low (below 0.3).
- If you can read most of it but some parts are unclear, set confidence between 0.3 and 0.7.
- If everything is clear, set confidence above 0.7.
- Do NOT solve the problem yourself — only extract what the student actually wrote."""


async def extract_student_work(
    submission_id: uuid.UUID,
    db: AsyncSession,
    *,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Call Claude Vision to extract the student's work steps from
    their uploaded homework photo.

    `user_id` is forwarded to the cost-tracking logger so the admin
    dashboard can attribute Vision calls to the student instead of
    showing "Deleted User".
    """
    image_data: str | None = (await db.execute(
        select(Submission.image_data).where(Submission.id == submission_id)
    )).scalar_one_or_none()

    if not image_data:
        logger.warning(
            "extract_student_work: no image for submission %s", submission_id,
        )
        return {"steps": [], "confidence": 0.0}

    base64_data, media_type = _strip_data_url_prefix(image_data)

    content: list[dict[str, Any]] = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": base64_data,
            },
        },
        {
            "type": "text",
            "text": (
                "Extract the student's handwritten work from this homework submission. "
                "List each step they wrote, in order."
            ),
        },
    ]

    result = await call_claude_vision(
        content,
        LLMMode.INTEGRITY_EXTRACT,
        tool_schema=INTEGRITY_EXTRACT_SCHEMA,
        model=MODEL_REASON,
        max_tokens=1024,
        user_id=user_id,
    )
    return result


# ── Conversational agent ────────────────────────────────────────────

AGENT_SYSTEM_PROMPT = """\
You are a math teacher meeting one-on-one with a student who just turned in \
handwritten homework. Your goal is to determine, with strong confidence within \
a few minutes, whether this student genuinely understands the material and did \
the work themselves.

You have the student's extracted work steps for each sampled problem. Confidence \
is earned when the student explains SPECIFIC things they wrote — which numbers \
they picked, why they applied a particular rule, what a symbol in their work \
represents. Confidence is NOT earned by assertion ("I understand it"), by \
correct final answers ("the answer is 5"), or by generic textbook definitions.

PROBING:
Start with an open question about what they wrote. If the answer is specific \
and grounded in their steps, move on. If it's vague, contradictory, or generic, \
ask a focused follow-up about the specific step. Aim for 1-3 student turns per \
problem — move on as soon as you have real signal. One question per turn. Keep \
replies short — two or three sentences tops.

RUBRIC:
For each problem you probe, call `submit_problem_verdict` with a six-dimension \
rubric:
  - paraphrase_originality (required): own words vs textbook verbatim
  - causal_fluency (required): smooth "because X, then Y" vs disconnected facts
  - transfer (optional): score only if you probed a "what if X were different?" \
twist
  - prediction (optional): score only if you probed "before calculating, which \
direction?"
  - authority_resistance (optional): score only if you floated a plausible-but-\
wrong premise and watched the reaction
  - self_correction: score low/mid/high if you observed it, or "not_observed" \
when turn volume was too small to judge

DISPOSITION (at session end, call `finish_check`):
  - pass = rubric strong across dimensions, behavioral clean. Understood deeply.
  - needs_practice = paraphrase mid-high (can describe steps), causal low \
(can't say why). Behavioral clean. They did the work but their theory is thin, \
OR they were helped (tutor/parent/AI) and partially absorbed it. Close warmly \
and offer practice reinforcement.
  - tutor_pivot = rubric low across the board AND the student got the problem \
WRONG or showed partial/struggling work on paper. They're learning, not cheating.
  - flag_for_review = rubric shallow AND the student got the problem CORRECT \
on paper AND (behavioral red flags OR cannot articulate any of their own work). \
Probably didn't do it themselves.

KEY DISCRIMINATORS:
  - tutor_pivot vs flag_for_review: did they get it RIGHT on paper? Wrong = \
learning. Right + can't explain any of it = something's off.
  - needs_practice vs flag_for_review: can they at least DESCRIBE mechanically \
what they did, even without explaining why? Yes = procedural knowledge. \
Totally blank on their own correct work = cheating signal.

AMBIGUITY RESOLUTION via INLINE VARIANT:
If a student has correct work on paper but cannot articulate any of it, AND \
behavioral signal is clean (not obviously a cheating pattern), it's ambiguous \
— they may be ESL/anxious/bad-at-verbalizing rather than cheating. Call \
`generate_variant(problem_id)` to get a fresh isomorphic problem. Present it \
in-chat and ask for the APPROACH in their own words — NOT a full solution. \
Two-step probe:

  Step 1: "Here's a similar problem: [variant]. How would you approach this one?"
    - If specific (references the actual structure, features, or numbers): \
upgrade to pass with inline_variant_result = "specific_approach".
    - If generic ("I'd use the quadratic formula"): ask step 2.

  Step 2: "Cool — what's the first thing you'd write down?"
    - If reasonable first step: upgrade to pass with inline_variant_result = \
"approach_after_followup".
    - If still blank or wrong: confirm flag_for_review with \
inline_variant_result = "blank_or_wrong".

Do NOT ask them to fully solve the variant. Use the variant at most once per \
session. Set inline_variant_result to "not_applicable" when you didn't use it.

TONE:
Warm, curious, never accusatory. Never use the words "cheat," "honest," or \
"verify" with the student. The student sees this as a quick chat about their \
work. If the disposition is flag_for_review, the student still sees a friendly \
"thanks, your work is with your teacher" — you are incapable of accusing."""


AGENT_TOOL_SCHEMAS = [
    INTEGRITY_SUBMIT_VERDICT_SCHEMA,
    INTEGRITY_GENERATE_VARIANT_SCHEMA,
    INTEGRITY_FINISH_CHECK_SCHEMA,
]


def build_problems_briefing(
    problems: list[dict[str, Any]],
) -> str:
    """Format the per-problem briefing that prefixes every agent call.

    `problems` is a list of dicts with keys:
      - problem_id: UUID string (what the agent passes to submit_problem_verdict)
      - sample_position: 0-based index
      - question: bank item question text
      - extraction: dict with `steps` and `confidence`
      - verdict_status: "pending" | "verdict_submitted"
    """
    lines: list[str] = [
        "You will be talking to the student about the problems below. "
        "Each problem has a problem_id you must pass back to "
        "`submit_problem_verdict`.",
    ]
    for p in problems:
        lines.append("")
        lines.append(
            f"--- Problem {p['sample_position'] + 1} "
            f"(problem_id: {p['problem_id']}) ---",
        )
        lines.append(f"Question: {p['question']}")
        lines.append("Student's extracted work:")
        steps = (p.get("extraction") or {}).get("steps") or []
        if not steps:
            lines.append("  (no legible steps)")
        else:
            for s in steps:
                lines.append(
                    f"  Step {s.get('step_num', '?')}: "
                    f"{s.get('plain_english', '')} "
                    f"[{s.get('latex', '')}]",
                )
        status = p.get("verdict_status", "pending")
        lines.append(f"Current verdict: {status}")
    return "\n".join(lines)


async def run_agent_turn(
    system_prompt: str,
    messages: list[dict[str, Any]],
    *,
    user_id: str | None = None,
) -> list[Any]:
    """One Claude round trip for the conversational integrity agent.

    Returns the raw response.content (list of content blocks). The
    caller walks the blocks: for tool_use blocks it must validate,
    apply side effects, and reply with tool_result messages; then
    call this again until the model returns text without any
    tool_use.
    """
    return await call_claude_conversation(
        system_prompt,
        messages,
        LLMMode.INTEGRITY_AGENT,
        tool_schemas=AGENT_TOOL_SCHEMAS,
        user_id=user_id,
        model=MODEL_REASON,
        max_tokens=AGENT_MAX_TOKENS_PER_TURN,
    )
