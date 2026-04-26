"""Question bank workshop chat orchestrator.

The teacher iterates with Claude in a persistent chat thread bolted to
each bank item. Claude can either just answer questions (proposal=null)
or return a scoped proposal (only the fields it wants to change). The
proposal is NOT applied to the live row — that only happens when the
teacher accepts via the /chat/accept endpoint. This two-step (propose
→ accept) shape keeps the teacher in control: Claude never silently
rewrites a question, and a bad proposal is one click away from being
discarded.
"""

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.document_vision import MAX_VISION_IMAGES, build_vision_content, fetch_document_images
from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json, call_claude_vision
from api.core.llm_schemas import BANK_CHAT_REPLY_SCHEMA
from api.core.subjects import get_config
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.models.unit import Unit

logger = logging.getLogger(__name__)

# Soft cap = frontend banner threshold (counted in TEACHER messages).
# Hard cap = backend enforced — bounded cost vector regardless of client.
# Window = trailing slice of chat_messages forwarded to Claude per call.
CHAT_SOFT_CAP = 20
CHAT_HARD_CAP = 100
CHAT_CONTEXT_WINDOW = 20


_WORKSHOP_CHAT_SYSTEM_PROMPT = """\
You are a {professor_role} working with a teacher in their question bank workshop.

The teacher has a question (with a worked solution) and may want to revise it,
ask you about it, or both. You can:

1. Just answer their question conversationally (set proposal=null).
2. Propose a scoped revision: only set the fields they want changed; leave other
   fields as null.

About the attached images (IMPORTANT):
- Any images attached to this conversation are the SOURCE MATERIALS the
  question was originally generated from (e.g. a textbook page, a worksheet,
  the teacher's class notes). They are NOT the question you are revising.
- The question you are revising is in the "Current question:" text below.
- Use the images ONLY as REFERENCE for style, notation, vocabulary, difficulty
  level, and topic scope. Match the textbook's voice when you propose changes.
- Do NOT treat problems shown in the source images as the question to edit.
  The teacher's question to edit is the one in the "Current question:" text.

Rules for proposals:
- Set proposal=null when the teacher is just asking ("why did you...", "is this
  too hard...", "what topic does this cover").
- When proposing changes, ONLY set fields that should change. Set unchanged
  top-level fields (question / solution_steps / final_answer) to null. The
  teacher will see only the changed parts highlighted.
- When you change the question, you may also need to change the solution and/or
  final answer if they would no longer match. Use your judgment.
- When you change just the solution, keep the question and final answer null
  (unless the teacher's request implies changing them).
- Use LaTeX with $ delimiters for math. Use single backslashes for LaTeX
  commands (e.g. \\frac, \\sqrt, \\begin{{pmatrix}}). Do not double-escape.
- Each solution step has a short title (2-5 words) and a full description.

CRITICAL — solution_steps is a FULL REPLACEMENT, not a patch:
- If you set solution_steps, you MUST return the complete list of all steps
  in the correct order. Unchanged steps must be included verbatim.
- Returning only the step(s) you modified will delete every step you omit.
- Only reduce the number of steps when the teacher explicitly asks you to
  remove, merge, or delete steps.
- If the teacher asks for a tweak to one step (e.g. "make step 3 more
  concise"), return all N original steps with only step 3 rewritten; keep
  the other N-1 steps exactly as they were.

Reply text:
- 1-3 sentences. Acknowledge the change, explain what you did, or answer the
  question.
- Don't repeat the proposal content in your reply — the teacher will see the
  preview directly.
"""


def _strip_internal_fields(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Convert chat_messages into the {role, content} pairs Claude expects.

    The proposal payload + accepted/discarded flags are stored in our DB
    representation but Claude only needs the role and the text. We also
    inline a short note when a proposal was accepted/discarded so Claude
    knows the workshop history."""
    out: list[dict[str, str]] = []
    for m in messages:
        role = "assistant" if m.get("role") == "ai" else "user"
        text = m.get("text", "")
        if m.get("role") == "ai" and m.get("proposal"):
            if m.get("accepted"):
                text += "\n\n[Teacher accepted this proposal.]"
            elif m.get("discarded"):
                text += "\n\n[Teacher discarded this proposal.]"
            else:
                text += "\n\n[Proposal pending review.]"
        out.append({"role": role, "content": text})
    return out


def _build_user_context(item: QuestionBankItem, unit_name: str, course_name: str) -> str:
    """The current state of the question, sent on every chat call so Claude
    always sees the live values (after any prior accepts)."""
    parts = [
        f"Course: {course_name}",
        f"Topic: {unit_name}",
        "",
        f"Current question:\n{item.question}",
    ]
    if item.solution_steps:
        steps_text = "\n".join(
            f"  {i + 1}. {s.get('title', '')}: {s.get('description', '')}"
            for i, s in enumerate(item.solution_steps)
        )
        parts.append(f"\nCurrent solution:\n{steps_text}")
    if item.final_answer:
        parts.append(f"\nCurrent final answer: {item.final_answer}")
    if item.generation_prompt:
        parts.append(f"\nOriginal generation constraint: {item.generation_prompt}")
    return "\n".join(parts)


async def chat_with_bank_item(
    db: AsyncSession,
    item: QuestionBankItem,
    course: Course,
    *,
    teacher_message: str,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Append the teacher's message, call Claude, append the AI response,
    persist. Returns the AI message dict that was just appended."""
    teacher_message = teacher_message.strip()
    if not teacher_message:
        raise ValueError("Empty message")

    # Initialize the column for legacy rows that pre-date the migration default
    if item.chat_messages is None:
        item.chat_messages = []

    # Hard cap: refuse new messages once a teacher has sent CHAT_HARD_CAP.
    # The frontend nudges at CHAT_SOFT_CAP, this is the actual limit so the
    # cost is bounded regardless of client behavior.
    teacher_count = sum(1 for m in item.chat_messages if m.get("role") == "teacher")
    if teacher_count >= CHAT_HARD_CAP:
        raise ValueError(
            f"Chat limit reached ({CHAT_HARD_CAP} messages). Clear the chat or start a new question."
        )

    now = datetime.now(UTC).isoformat()

    # Build the prompt against the future history (existing + the new
    # teacher message), but DON'T persist it yet — if Claude fails we
    # don't want a stranded teacher message in the DB. Persist both
    # messages atomically after Claude returns.
    teacher_msg = {"role": "teacher", "text": teacher_message, "ts": now}
    pending_history = [*item.chat_messages, teacher_msg]

    # Build prompt context
    unit_name = course.name
    if item.unit_id:
        unit = (await db.execute(select(Unit).where(Unit.id == item.unit_id))).scalar_one_or_none()
        if unit:
            unit_name = unit.name

    cfg = get_config(course.subject)
    system_prompt = _WORKSHOP_CHAT_SYSTEM_PROMPT.format(professor_role=cfg["professor_role"])

    user_context = _build_user_context(item, unit_name, course.name)

    # Trim history for the call (uses the pending list including the new msg)
    history = _strip_internal_fields(pending_history[-CHAT_CONTEXT_WINDOW:])

    doc_ids = [uuid.UUID(d) for d in (item.source_doc_ids or [])]
    images = await fetch_document_images(
        db, doc_ids, item.course_id, max_images=MAX_VISION_IMAGES,
    )

    # Build the user message that opens the conversation context
    seed_lines = [user_context, "", "Conversation:"]
    for h in history:
        prefix = "Teacher" if h["role"] == "user" else "You"
        seed_lines.append(f"\n{prefix}: {h['content']}")
    seed_lines.append("\nNow respond to the teacher's most recent message.")
    seed = "\n".join(seed_lines)

    try:
        if images:
            # call_claude_vision doesn't take a separate system prompt — inline
            # the workshop role into the user content prefix. The image
            # preamble is loud on purpose: without it Claude tends to read the
            # images as "the question to edit" rather than reference material.
            image_preamble = (
                "The following images are the SOURCE MATERIALS the question "
                "was originally generated from — textbook pages, worksheets, "
                "or notes. They are reference for style/notation/topic only. "
                "They are NOT the question you are revising. The question to "
                "revise is in the 'Current question:' text further down."
            )
            content = build_vision_content(
                images, f"{system_prompt}\n\n{image_preamble}\n\n{seed}",
            )
            result = await call_claude_vision(
                content,
                mode=LLMMode.BANK_CHAT,
                tool_schema=BANK_CHAT_REPLY_SCHEMA,
                user_id=str(user_id),
                model=MODEL_REASON,
                max_tokens=4096,
            )
        else:
            result = await call_claude_json(
                system_prompt,
                seed,
                mode=LLMMode.BANK_CHAT,
                tool_schema=BANK_CHAT_REPLY_SCHEMA,
                user_id=str(user_id),
                model=MODEL_REASON,
                max_tokens=4096,
            )
    except Exception as e:
        logger.exception("Bank chat call failed")
        raise RuntimeError(f"AI chat failed: {e}") from e

    reply = str(result.get("reply") or "").strip()
    proposal_raw = result.get("proposal")
    proposal: dict[str, Any] | None = None
    if isinstance(proposal_raw, dict):
        steps_raw = proposal_raw.get("solution_steps")
        # Filter to well-formed steps only: {title: str, description: str}.
        # Claude almost always honors the schema, but if a malformed step
        # slips through it would be stored in chat_messages and applied
        # to item.solution_steps on accept, crashing the frontend render.
        cleaned_steps: list[dict[str, Any]] | None = None
        if isinstance(steps_raw, list):
            cleaned_steps = [
                {"title": s["title"], "description": s["description"]}
                for s in steps_raw
                if isinstance(s, dict)
                and isinstance(s.get("title"), str)
                and isinstance(s.get("description"), str)
            ]
            if not cleaned_steps:
                cleaned_steps = None
        proposal = {
            "question": proposal_raw.get("question") if proposal_raw.get("question") else None,
            "solution_steps": cleaned_steps,
            "final_answer": proposal_raw.get("final_answer")
            if proposal_raw.get("final_answer")
            else None,
        }
        # Drop the proposal entirely if every field is null
        if all(v is None for v in proposal.values()):
            proposal = None

    ai_msg: dict[str, Any] = {
        "role": "ai",
        "text": reply or "(no reply)",
        "ts": datetime.now(UTC).isoformat(),
    }
    if proposal:
        ai_msg["proposal"] = proposal

    # Single-pending invariant: a new reply supersedes any earlier
    # unresolved proposals. Without this, discarding the most recent
    # proposal would let a stale older one bubble back as "pending"
    # and the teacher would think the same suggestion came back.
    superseded_history = [
        {**m, "superseded": True}
        if (
            m.get("role") == "ai"
            and m.get("proposal")
            and not m.get("accepted")
            and not m.get("discarded")
            and not m.get("superseded")
        )
        else m
        for m in pending_history
    ]

    # Atomic persist: both the teacher message AND the AI reply land in
    # the same commit. If Claude failed above, neither was persisted, so
    # the frontend can re-submit the original draft cleanly.
    item.chat_messages = [*superseded_history, ai_msg]
    await db.commit()

    return ai_msg
