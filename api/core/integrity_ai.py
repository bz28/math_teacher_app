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
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.image_utils import to_content_block
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


def _strip_data_url_prefix(data: str, fallback_media_type: str) -> tuple[str, str]:
    """Strip the data URL prefix and return (base64, media_type).

    Handles:
    - "data:image/png;base64,iVBOR..."  → ("iVBOR...", "image/png")
    - "data:application/pdf;base64,..." → ("...", "application/pdf")
    - "iVBOR..." (raw base64, PNG)      → ("iVBOR...", "image/png")
    - "/9j/..." (raw base64, JPEG)      → ("/9j/...", "image/jpeg")
    - anything else                     → (data, fallback_media_type)

    `fallback_media_type` is what the database row recorded for this
    file when it was validated at submit time. We trust that over a
    raw-bytes guess if no data-URL prefix is present.
    """
    m = re.match(r"^data:([\w/+.\-]+);base64,", data)
    if m:
        media_type = m.group(1)
        if media_type == "image/jpg":
            media_type = "image/jpeg"
        return data[m.end():], media_type
    if data.startswith("iVBOR"):
        return data, "image/png"
    if data.startswith("/9j/"):
        return data, "image/jpeg"
    return data, fallback_media_type


# ── Extraction ──────────────────────────────────────────────────────

_EXTRACT_SYSTEM = """\
You are a world-class math professor examining a student's handwritten homework submission. \
Your task is to extract the student's work steps from the image into structured data \
AND attribute each step to the homework problem it belongs to so downstream grading \
can compare the right work against the right answer key.

Rules:
- List every distinct step the student wrote, in order from top to bottom.
- For each step, provide both the LaTeX representation and a plain-English description.
- **Attribute each step to a problem**: set `problem_position` to the 1-based index of \
the homework problem the step belongs to (as shown in the problem list in the user \
message). Use spatial cues (student-written labels like "1.", "Problem 2:", "(a)"; \
adjacency on the page; visual separation) AND content cues (does the math match the \
question?). Set `problem_position` to null only when the step genuinely can't be \
attributed — scratch work, cross-problem setup, notes to themselves. Don't guess \
when unsure; null is the honest answer.
- **Extract final answers per problem**: whenever the student wrote something that \
reads as a concluding answer for a problem (circled, boxed, on the "answer" line, or \
the last step of that problem's work), include a `final_answers` entry with the \
problem's position and the answer in LaTeX + plain English. Omit problems that have \
no discernible final answer.
- **Ignore printed worksheet text.** Skip anything pre-printed on the page (problem \
statements, "Name:", "Date:", instructions). Only extract what the student handwrote.
- If the handwriting is illegible or the image is blurry, set confidence low (below 0.3).
- If you can read most of it but some parts are unclear, set confidence between 0.3 and 0.7.
- If everything is clear, set confidence above 0.7.
- Do NOT solve the problem yourself — only extract what the student actually wrote."""


def _format_problems_briefing(problems: list[dict[str, Any]] | None) -> str:
    """Render the problem list as a numbered briefing Vision can cite by
    position when tagging steps. Empty when no problems are provided —
    caller falls back to untagged extraction behavior.

    Deliberately renders only `position` + `question` — not
    `final_answer` — even though the shared `load_problems_for_assignment`
    dict carries the answer key. Vision is reading the student's work,
    not grading it; leaking the answer key here would let the model
    "snap" the student's extracted work toward the correct answer
    instead of transcribing what's actually on the page.
    """
    if not problems:
        return ""
    lines = ["The homework has these problems (use these positions when tagging):"]
    for p in problems:
        pos = p.get("position")
        question = p.get("question") or "(no question text)"
        lines.append(f"Problem {pos}: {question}")
    return "\n".join(lines) + "\n\n"


async def extract_student_work(
    submission_id: uuid.UUID,
    db: AsyncSession,
    *,
    problems: list[dict[str, Any]] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Call Claude Vision to extract the student's work from their
    uploaded homework photo, optionally attributing each step to a
    homework problem.

    When `problems` is provided (list of
    `{position, question, final_answer, ...}` dicts from
    `load_problems_for_assignment`), Vision sees them as context and
    tags each step's `problem_position` + emits a `final_answers`
    list per problem. When omitted, the result still conforms to the
    schema but `problem_position` will be null and `final_answers`
    will be empty — useful for callers that don't have the HW
    context (e.g. the unreadable-gate fallback before the caller
    knows which assignment it's dealing with).

    `user_id` is forwarded to the cost-tracking logger so the admin
    dashboard can attribute Vision calls to the student instead of
    showing "Deleted User".
    """
    files: list[Any] | None = (await db.execute(
        select(Submission.files).where(Submission.id == submission_id)
    )).scalar_one_or_none()

    if not files:
        logger.warning(
            "extract_student_work: no files for submission %s", submission_id,
        )
        return {"steps": [], "final_answers": [], "confidence": 0.0}

    briefing = _format_problems_briefing(problems)
    instruction = (
        "Extract the student's handwritten work from this homework submission. "
        "Pages are sent in order — treat them as one document so work that "
        "spans pages stitches across cleanly. List each step the student "
        "wrote, in order, and tag each step with the problem_position it "
        "belongs to. Extract each problem's final answer when the student "
        "wrote one."
    )

    content: list[dict[str, Any]] = []
    for f in files:
        raw = f.get("data", "")
        recorded_media = f.get("media_type", "image/jpeg")
        base64_data, media_type = _strip_data_url_prefix(raw, recorded_media)
        content.append(to_content_block(media_type, base64_data))
    content.append({
        "type": "text",
        "text": briefing + instruction if briefing else instruction,
    })

    # 1024 was too tight for real HW submissions: a multi-problem HW
    # with dense handwriting pushes the tool-use JSON (per-step
    # plain_english + latex + per-problem final_answers) well past
    # that, so Claude cut off at max_tokens and `stop_reason` came
    # back as `max_tokens` instead of `tool_use`/`end_turn`. The
    # wrapper rejected the truncated response, the background task
    # caught silently, and submissions sat with extraction=null.
    # 4096 gives comfortable headroom for the densest real submissions
    # (well under Claude's output cap) without letting the prompt run
    # away. Bump further if we ever see `max_tokens` again in logs.
    result = await call_claude_vision(
        content,
        LLMMode.INTEGRITY_EXTRACT,
        tool_schema=INTEGRITY_EXTRACT_SCHEMA,
        model=MODEL_REASON,
        max_tokens=4096,
        user_id=user_id,
    )
    return result


# ── Conversational agent ────────────────────────────────────────────

# Local mirror of integrity_pipeline.AgentPosture. Duplicated to avoid
# the circular import (integrity_pipeline imports from this module),
# and kept in lockstep with POSTURE_PROMPT_FRAGMENTS' keys below.
_AgentPosture = Literal["verified", "struggling_attempted", "struggling_blank"]


# Posture fragments interpolated into AGENT_SYSTEM_PROMPT per chat at
# the {student_signal} placeholder. The selector classifies the
# submission into a tier + posture (see
# api.core.integrity_pipeline.derive_agent_posture); the right fragment
# tells the agent which lane it's in so its tone, expected dispositions,
# and approach to probing all match the student's actual signal.
POSTURE_PROMPT_FRAGMENTS: dict[_AgentPosture, str] = {
    "verified": (
        "STUDENT SIGNAL — VERIFIED:\n"
        "The student got at least one final answer correct on this homework, "
        "and we picked the hardest one they got right to discuss with you. "
        "Your job is to verify they actually understand it — strong "
        "comprehension earns `pass`; correct answer with no real explanation "
        "is the `flag_for_review` lane. `tutor_pivot` and `needs_practice` "
        "should be rare here."
    ),
    "struggling_attempted": (
        "STUDENT SIGNAL — STRUGGLING (attempted):\n"
        "The student got every final answer wrong on this homework, but they "
        "wrote real work for the problem we picked. Your job is to find "
        "where the approach broke down. Anchor on what they wrote. Tutoring "
        "mid-chat is welcome — explain a concept if it helps. Likely "
        "dispositions: `needs_practice` if they have procedural understanding "
        "but conceptual gaps; `tutor_pivot` if they're genuinely lost on the "
        "underlying concept. `flag_for_review` is unlikely — they got it "
        "wrong, not suspiciously right."
    ),
    "struggling_blank": (
        "STUDENT SIGNAL — STRUGGLING (blank):\n"
        "The student got every final answer wrong on this homework AND "
        "barely wrote anything for the problem we picked — so don't ask "
        "them to walk through steps that don't exist. Anchor on the problem "
        "itself: 'what part of this feels confusing?' or 'where would you "
        "start?' Pivot to tutoring early. Likely disposition: `tutor_pivot`. "
        "`flag_for_review` does not apply here — there's nothing on paper "
        "to be suspicious about."
    ),
}


# {student_signal} is filled by build_agent_system_prompt with one of
# POSTURE_PROMPT_FRAGMENTS above. Any other literal `{...}` token in
# this string would crash str.format — escape with `{{ }}` if needed.
AGENT_SYSTEM_PROMPT = """\
You are a math teacher meeting one-on-one with a student who just turned in \
handwritten homework. Your goal is to determine, with strong confidence within \
a few minutes, whether this student genuinely understands the material and did \
the work themselves.

{student_signal}

You have the student's extracted work steps for each sampled problem AND the \
answer-key correct final answer. Confidence is earned when the student explains \
SPECIFIC things they wrote — which numbers they picked, why they applied a \
particular rule, what a symbol in their work represents. Confidence is NOT \
earned by assertion ("I understand it"), by correct final answers ("the answer \
is 5"), or by generic textbook definitions.

CORRECTNESS ANCHORING:
Decide "right on paper" vs "wrong on paper" by comparing the student's \
extracted final answer against the answer key in the briefing — NOT by how \
confident the student sounds verbally. A fluent verbal explanation does not \
make the work correct; only the answer key does. If the answer key is missing \
or the comparison is genuinely ambiguous, lean toward "wrong on paper" and \
probe further before finalizing.

TOPIC MISMATCH:
If the student's verbal explanation, or the work shown in the extraction, \
describes a different problem than the one in the briefing — different \
quantities, different setup, a different domain entirely — that is a strong \
mismatch signal. Treat it as flag_for_review regardless of how fluent the \
explanation sounds; describing the wrong problem confidently is more \
suspicious than describing the right problem haltingly.

NEVER reveal the answer key to the student. The answer key is your private \
reference for evaluating their work; the student should not see it in your \
chat replies.

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

finish_check is TERMINAL. Never call it in the same response as a new question \
to the student. If you're still probing, let the student reply first. Only \
finalize in a response where you have nothing more to ask — no trailing \
question marks, no "can you tell me more", no "what about X". Withdraw \
outstanding questions before finalizing or wait for the student's next turn.

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


def build_agent_system_prompt(posture: _AgentPosture) -> str:
    """Render AGENT_SYSTEM_PROMPT with the posture fragment slotted in.

    Falls back to "verified" if the value is unrecognized, since
    "verify the win" is the closest to neutral teacher framing.
    """
    fragment = POSTURE_PROMPT_FRAGMENTS.get(
        posture, POSTURE_PROMPT_FRAGMENTS["verified"],
    )
    return AGENT_SYSTEM_PROMPT.format(student_signal=fragment)


def build_problems_briefing(
    problems: list[dict[str, Any]],
) -> str:
    """Format the per-problem briefing that prefixes every agent call.

    `problems` is a list of dicts with keys:
      - problem_id: UUID string (what the agent passes to submit_problem_verdict)
      - sample_position: 0-based index in the sampled list (internal)
      - hw_position: 1-based position on the homework (what the
        student sees in the chat reference panel as "Problem N").
        The agent labels problems by this so any "let's talk about
        Problem 3" reference matches the student's view.
      - question: bank item question text
      - correct_final_answer: the bank item's authoritative final answer
        (string). The agent compares the student's extracted answer
        against this to decide "right vs wrong on paper" — replaces
        the prior approach where the agent had to mentally re-solve
        every problem. May be empty for legacy items without an answer.
      - extraction: dict with `steps`, `final_answers`, and `confidence`
        (now pre-sliced to just this problem's work)
      - verdict_status: "pending" | "verdict_submitted"
    """
    lines: list[str] = [
        "You will be talking to the student about the problems below. "
        "Each problem has a problem_id you must pass back to "
        "`submit_problem_verdict`.",
    ]
    for p in problems:
        lines.append("")
        # Use hw_position so the agent's labeling matches what the
        # student sees in the chat reference panel. Defensive
        # fallback to sample_position+1 for older callers that
        # haven't been migrated yet.
        position = p.get("hw_position", p.get("sample_position", 0) + 1)
        lines.append(
            f"--- Problem {position} "
            f"(problem_id: {p['problem_id']}) ---",
        )
        lines.append(f"Question: {p['question']}")
        correct = (p.get("correct_final_answer") or "").strip()
        if correct:
            lines.append(f"Correct final answer (answer key): {correct}")
        extraction = p.get("extraction") or {}
        lines.append("Student's extracted work:")
        steps = extraction.get("steps") or []
        if not steps:
            lines.append("  (no legible steps)")
        else:
            for s in steps:
                lines.append(
                    f"  Step {s.get('step_num', '?')}: "
                    f"{s.get('plain_english', '')} "
                    f"[{s.get('latex', '')}]",
                )
        # Student's final answer(s) on this problem, when Vision
        # extracted one. Separated from the step list so the agent can
        # probe it as a conclusion rather than mistake it for another
        # step. The extraction schema doesn't enforce uniqueness on
        # problem_position, so render every matching entry — the agent
        # sees every candidate rather than silently losing all but one.
        final_answers = extraction.get("final_answers") or []
        if final_answers:
            label = (
                "Student's final answer"
                if len(final_answers) == 1
                else "Student's final answers (multiple extracted)"
            )
            lines.append(f"{label}:")
            for fa in final_answers:
                answer = (
                    fa.get("answer_latex")
                    or fa.get("answer_plain")
                    or "(no answer)"
                )
                lines.append(f"  {answer}")
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
