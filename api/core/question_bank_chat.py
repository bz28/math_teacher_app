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

import json
import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.construction_figures import (
    CONSTRUCTION_FIGURE_RULES,
    _join,
    failure_sentence,
    figure_sentence,
    without_figure_talk,
)
from api.core.document_vision import MAX_VISION_IMAGES, build_vision_content, fetch_source_documents
from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json, call_claude_vision
from api.core.llm_schemas import BANK_CHAT_REPLY_CONSTRUCTION_SCHEMA
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


_CHAT_SYSTEM_TEMPLATE = """\
You are a {professor_role} working with a teacher in their question bank workshop.

The teacher has a question (with a worked solution) and may want to revise it,
ask you about it, or both. You can:

1. Just answer their question conversationally (set proposal=null).
2. Propose a scoped revision: only set the fields they want changed; leave other
   fields as null.

About the attached source documents (IMPORTANT):
- Any documents attached to this conversation — images or PDFs — are the
  SOURCE MATERIALS the question was originally generated from (e.g. a textbook
  page, a worksheet, the teacher's class notes). They are NOT the question you
  are revising.
- The question you are revising is in the "Current question:" text below.
- Use them ONLY as REFERENCE for style, notation, vocabulary, difficulty
  level, and topic scope. Match the textbook's voice when you propose changes.
- Do NOT treat problems shown in the source documents as the question to edit.
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

<<FIGURES>>CRITICAL — solution_steps is a FULL REPLACEMENT, not a patch:
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


# The chat's figure section, put in at <<FIGURES>> (after formatting: the
# shared rules carry literal braces).
_CHAT_CONSTRUCTION_FIGURES = """\
Geometry figures:

The question and EACH solution step can carry a `figure_spec`. Emit one when
the teacher asks for a drawing or diagram, or when the question refers to a
figure it doesn't have. To change an existing figure (add a segment, a
label), return the WHOLE new figure_spec: keep every point where it is and
change only what was asked. A step's figure must keep the question figure's
points where they are and keep everything it draws; it may add what that
step introduces. If you rewrite the question and it has a figure, return a
new figure_spec that matches the new question.

Do NOT describe a figure in your reply: code checks the figure and writes
the sentence about it from what it actually drew.

"""


def _chat_system_prompt(professor_role: str) -> str:
    return _CHAT_SYSTEM_TEMPLATE.format(professor_role=professor_role).replace(
        "<<FIGURES>>", _CHAT_CONSTRUCTION_FIGURES + CONSTRUCTION_FIGURE_RULES + "\n\n",
    )


def _strip_figure_svg_on_supersede(msg: dict[str, Any]) -> dict[str, Any]:
    """Drop the pre-rendered figure_svg from a superseded proposal —
    same shape as the route-layer helper in teacher_question_bank.
    Keeps the canonical figure_spec; only the rendered cache is shed."""
    proposal = msg.get("proposal")
    if not isinstance(proposal, dict):
        return msg
    cleaned_proposal: dict[str, Any] = {
        k: v for k, v in proposal.items() if k != "figure_svg"
    }
    steps = cleaned_proposal.get("solution_steps")
    if isinstance(steps, list):
        cleaned_proposal["solution_steps"] = [
            {k: v for k, v in s.items() if k != "figure_svg"}
            if isinstance(s, dict) else s
            for s in steps
        ]
    return {**msg, "proposal": cleaned_proposal}


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


def _figure_context(item: QuestionBankItem) -> str:
    """The figures the model is editing, as data: the question's current
    figure and the one in its own pending proposal. Without them a
    follow-up ("now label angle 1") redraws from scratch and moves things."""
    parts: list[str] = []
    if isinstance(item.figure_spec, dict):
        parts.append(f"\nCurrent figure (figure_spec):\n{json.dumps(item.figure_spec)}")
        facts = getattr(item, "figure_facts", None)
        if isinstance(facts, dict):
            # What the figure (and any step figure) is checked against.
            parts.append(
                "\nThe problem's facts, which the figure and every step figure are checked "
                f"against:\n{json.dumps(facts, sort_keys=True)}",
            )
    pending = next(
        (
            m["proposal"] for m in reversed(item.chat_messages or [])
            if m.get("role") == "ai" and isinstance(m.get("proposal"), dict)
            and not m.get("accepted") and not m.get("discarded") and not m.get("superseded")
        ),
        None,
    )
    if pending and isinstance(pending.get("figure_spec"), dict):
        parts.append(
            "\nYour pending proposal's figure (not accepted yet):\n"
            + json.dumps(pending["figure_spec"]),
        )
    return "".join(parts)


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
    system_prompt = _chat_system_prompt(str(cfg["professor_role"]))
    reply_schema = BANK_CHAT_REPLY_CONSTRUCTION_SCHEMA

    user_context = _build_user_context(item, unit_name, course.name) + _figure_context(item)

    # Trim history for the call (uses the pending list including the new msg)
    history = _strip_internal_fields(pending_history[-CHAT_CONTEXT_WINDOW:])

    doc_ids = [uuid.UUID(d) for d in (item.source_doc_ids or [])]
    images = await fetch_source_documents(
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
            # source docs as "the question to edit" rather than reference material.
            source_preamble = (
                "The attached documents are the SOURCE MATERIALS the question "
                "was originally generated from — textbook pages, worksheets, "
                "or notes. They are reference for style/notation/topic only. "
                "They are NOT the question you are revising. The question to "
                "revise is in the 'Current question:' text further down."
            )
            content = build_vision_content(
                images, f"{system_prompt}\n\n{source_preamble}\n\n{seed}",
            )
            result = await call_claude_vision(
                content,
                mode=LLMMode.BANK_CHAT,
                tool_schema=reply_schema,
                user_id=str(user_id),
                model=MODEL_REASON,
                max_tokens=4096,
            )
        else:
            result = await call_claude_json(
                system_prompt,
                seed,
                mode=LLMMode.BANK_CHAT,
                tool_schema=reply_schema,
                user_id=str(user_id),
                model=MODEL_REASON,
                max_tokens=4096,
            )
    except Exception as e:
        logger.exception("Bank chat call failed")
        raise RuntimeError(f"AI chat failed: {e}") from e

    # Local import — keeps the chat module loadable without the
    # geometry render path, but lets us pre-render the proposal's
    # figures here so the preview UI can show them before the teacher
    # clicks Accept. Without pre-rendering, the preview reads
    # figure_svg=None (since the proposal carries raw figure_spec)
    # and the diagram only appears post-accept — confusing UX.
    from api.core.geometry.facts import as_facts
    from api.core.question_bank_generation import (
        _check_figure,
        _figure_drop_reason,
        _is_construction,
        _render_step_figures,
        _render_step_figures_with_retry,
        _resolve_figure,
        _resolve_figure_with_retry,
    )

    reply = str(result.get("reply") or "").strip()
    proposal_raw = result.get("proposal")
    proposal: dict[str, Any] | None = None
    # Figures the model emitted that didn't survive rendering. Its reply
    # was written before that ("I've added the diagram"), so without a
    # note the teacher reads a promise and sees nothing (prod, 2026-11-01).
    figure_drop: str | None = None
    step_drops: list[str] = []
    # Construction figures: what was asked of the figure and what came of
    # it, so the sentence about it is written here from what was drawn.
    top_construction = False
    top_issues: list[str] = []
    construction_step_drops: dict[int, list[str]] = {}
    any_construction_step = False
    top_text = item.question
    # The problem's agreed reading the construction figure was checked
    # against (stored with the figure on accept).
    top_facts: Any = None
    step_facts: Any = None
    if isinstance(proposal_raw, dict):
        steps_raw = proposal_raw.get("solution_steps")
        top_spec_raw = proposal_raw.get("figure_spec")
        top_text = proposal_raw.get("question") or item.question
        rewrites_question = bool(proposal_raw.get("question"))

        # Top-level question figure: pass through + pre-render so the
        # preview UI shows the diagram alongside the question text. A
        # construction is checked against the problem (and the teacher's
        # request), with one retry on the checker's errors.
        top_construction = _is_construction(top_spec_raw)
        if top_construction:
            answer = str(proposal_raw.get("final_answer") or ("" if rewrites_question else item.final_answer or ""))
            top_figure_spec, top_figure_svg, top_issues, top_facts = await _resolve_figure_with_retry(
                top_spec_raw, top_text, mode=LLMMode.BANK_CHAT, user_id=str(user_id),
                final_answer=answer, request=teacher_message,
            )
        else:
            top_figure_spec, top_figure_svg = _resolve_figure(top_spec_raw, top_text)
            if isinstance(top_spec_raw, dict) and top_figure_svg is None:
                figure_drop = f"I couldn't draw the diagram. {_figure_drop_reason(top_spec_raw, top_text)}"

        # Filter to well-formed steps. Required: title (str) +
        # description (str). Optional pass-through: figure_spec when
        # the AI emitted one (dict — rendered by accept_chat_proposal
        # via _render_step_figures). Earlier versions of this filter
        # dropped figure_spec; the chat looked like it was producing
        # diagrams in the reply text but never actually populated the
        # field, so step diagrams silently never appeared.
        cleaned_steps: list[dict[str, Any]] | None = None
        if isinstance(steps_raw, list):
            tmp: list[dict[str, Any]] = []
            for s in steps_raw:
                if not isinstance(s, dict):
                    continue
                if not isinstance(s.get("title"), str) or not isinstance(s.get("description"), str):
                    continue
                step: dict[str, Any] = {
                    "title": s["title"], "description": s["description"],
                }
                if isinstance(s.get("figure_spec"), dict):
                    step["figure_spec"] = s["figure_spec"]
                tmp.append(step)
            # A step figure is checked against the figure the question
            # will have: the proposal's new one, else (question unchanged)
            # the current one.
            step_base = top_figure_spec if top_figure_spec is not None else (
                None if rewrites_question else item.figure_spec
            )
            # ...and against that question's reading: the proposal's, else
            # (question unchanged) the stored one, else it is read once.
            step_facts = top_facts if top_figure_svg else (
                None if rewrites_question else item.figure_facts
            )
            # Pre-render any per-step figures so the preview can
            # display them; accept_chat_proposal re-runs the same
            # path to write the final state.
            if tmp:
                cleaned_steps, construction_step_drops, step_facts = await _render_step_figures_with_retry(
                    tmp, question_text=top_text, question_spec=step_base,
                    mode=LLMMode.BANK_CHAT, user_id=str(user_id), facts=step_facts,
                )
            any_construction_step = any(_is_construction(s.get("figure_spec")) for s in tmp)
            # _render_step_figures keeps every (dict) step, in order.
            step_drops = [
                f"I couldn't draw the diagram for step {i}. "
                f"{_figure_drop_reason(raw['figure_spec'], '')}"
                for i, (raw, out) in enumerate(zip(tmp, cleaned_steps or []), start=1)
                if "figure_spec" in raw and "figure_svg" not in out
                and not _is_construction(raw["figure_spec"])
            ]

        proposal = {
            "question": proposal_raw.get("question") if proposal_raw.get("question") else None,
            "solution_steps": cleaned_steps,
            "final_answer": proposal_raw.get("final_answer")
            if proposal_raw.get("final_answer")
            else None,
            "figure_spec": top_figure_spec,
            "figure_svg": top_figure_svg,
        }
        # Drop the proposal entirely if every field is null
        if all(v is None for v in proposal.values()):
            proposal = None
        else:
            if top_figure_svg and top_facts is not None:
                proposal["figure_facts"] = as_facts(top_facts).model_dump()  # type: ignore[union-attr]
            # The reading the step figures were checked against, so accept
            # checks them against the same one.
            if any_construction_step and step_facts is not None:
                proposal["step_facts"] = as_facts(step_facts).model_dump()  # type: ignore[union-attr]

    # Deterministic correctness: when the proposal rewrites the QUESTION, the
    # chat's own inline solution can silently disagree with it — it may fudge a
    # value to land a rounder answer, or "verify" against a stale number (we
    # saw exactly this: a tangent–secant rewrite that reported 166° for a
    # problem whose real answer is 178°). Rather than trust the chat to grade
    # itself, re-solve the new question with the SAME decomposition path that
    # first-pass generation uses, and take the solution + final answer from the
    # solver. The chat owns the question text (and figure); the solver owns the
    # answer. If the solver itself fails, we keep the chat's inline solution
    # (no worse than before) rather than block the proposal.
    if proposal and proposal.get("question"):
        from api.core.assignment_generation import generate_solutions
        from api.core.constants import SOLUTION_FAILED_SENTINEL_PREFIX

        try:
            solved = await generate_solutions(
                [{"text": proposal["question"], "figure_spec": proposal["figure_spec"]}],
                subject=course.subject,
                user_id=str(user_id),
            )
        except Exception:
            logger.exception("Workshop re-solve failed; keeping chat's inline solution")
            solved = []
        sol = solved[0] if solved else None
        if sol and not str(sol.get("final_answer") or "").startswith(
            SOLUTION_FAILED_SENTINEL_PREFIX
        ):
            steps = sol.get("steps")
            proposal["solution_steps"] = (
                _render_step_figures(
                    steps, question_text=proposal["question"], question_spec=proposal["figure_spec"],
                    facts=proposal.get("figure_facts"),
                )
                if isinstance(steps, list) and steps else None
            )
            proposal["final_answer"] = str(sol.get("final_answer") or "") or None
            # The answer is the solver's now: a construction figure must
            # not print it.
            if _is_construction(proposal["figure_spec"]):
                spec, svg, issues = _check_figure(
                    proposal["figure_spec"], proposal["question"],
                    final_answer=proposal["final_answer"] or "", request=teacher_message,
                    facts=proposal.get("figure_facts"),
                )
                proposal["figure_spec"], proposal["figure_svg"] = spec, svg
                if not svg:
                    proposal.pop("figure_facts", None)
                top_issues = issues
            # Replace (not append) the chat's prose: its narrative may assert a
            # specific answer it computed free-hand, which can disagree with the
            # solver's verified one (we saw the reply claim 118° while the
            # solver returned the correct 178°). A contradictory reply next to
            # the preview reads as broken. State only what we can stand behind.
            reply = (
                "I've rewritten the problem. To make sure the rewrite is "
                "correct, the solution steps and final answer below were "
                "re-derived independently rather than written by hand."
            )
            step_drops = []  # the chat's steps (and their figures) were replaced
            proposal.pop("step_facts", None)
            construction_step_drops = {}
            any_construction_step = False

    if top_construction or any_construction_step or (figure_drop is None and not step_drops):
        reply = _construction_reply(
            reply, proposal, item, teacher_message, top_text,
            top_construction=top_construction, top_issues=top_issues,
            step_drops=construction_step_drops,
        )
    if figure_drop and not proposal:
        # The figure was the whole edit: the reply describes a change that
        # isn't there, so say what actually happened instead.
        reply = f"{figure_drop} Nothing was changed."
    elif figure_drop or step_drops:
        notes = [f"{figure_drop} This proposal doesn't include one."] if figure_drop else []
        notes += [f"{d} That step is shown without one." for d in step_drops]
        reply = "\n\n".join(filter(None, [reply, *notes]))

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
    #
    # When marking superseded, also strip the pre-rendered figure_svg
    # from the proposal (canonical figure_spec stays for audit). The
    # SVG was needed only for the preview UI while the proposal was
    # pending — once superseded it's dead weight in the JSON column.
    # Over a long chat with multiple geometry revisions this strip
    # prevents accumulated multi-KB SVGs from bloating chat_messages.
    superseded_history = [
        _strip_figure_svg_on_supersede({**m, "superseded": True})
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


def _construction_reply(
    reply: str,
    proposal: dict[str, Any] | None,
    item: QuestionBankItem,
    teacher_message: str,
    question_text: str,
    *,
    top_construction: bool,
    top_issues: list[str],
    step_drops: dict[int, list[str]],
) -> str:
    """The reply with its figure sentence written by code.

    The model writes its reply before anything is drawn, so whatever it
    says about a figure describes intent, not the result (prod: "with
    diagonal AC drawn" on a figure without AC). When the proposal carries
    a construction figure, the model's figure sentences are dropped and
    replaced with one built from what was drawn — or with the checker's
    reasons when nothing could be drawn. When no figure was drawn at all,
    a sentence claiming one is dropped and the teacher is told plainly."""
    from api.core.question_bank_generation import _FIGURE_REFERENCE, _is_construction

    drew_top = bool(proposal and proposal.get("figure_svg"))
    drew_step = bool(proposal and any(
        isinstance(s, dict) and s.get("figure_svg") for s in (proposal.get("solution_steps") or [])
    ))
    notes: list[str] = []
    if top_construction or step_drops or (drew_step and _proposal_has_construction_step(proposal)):
        kept = without_figure_talk(reply)
        if top_construction and drew_top:
            assert proposal is not None
            notes.append(figure_sentence(
                proposal["figure_spec"], teacher_message, updated=bool(item.figure_spec),
                problem_text=question_text, facts=proposal.get("figure_facts"),
            ))
        elif top_construction:
            notes.append(failure_sentence(top_issues or ["the figure didn't pass its check"]))
        drawn_steps = [
            str(n) for n, s in enumerate((proposal or {}).get("solution_steps") or [], start=1)
            if isinstance(s, dict) and s.get("figure_svg") and _is_construction(s.get("figure_spec"))
        ]
        if drawn_steps:
            plural = "s" if len(drawn_steps) > 1 else ""
            notes.append(f"I've added a diagram to step{plural} {_join(drawn_steps)}.")
        notes += [
            f"{failure_sentence(issues, step=n)} That step is shown without one."
            for n, issues in sorted(step_drops.items())
        ]
        if top_construction and not drew_top and proposal is None:
            return f"{notes[0]} Nothing was changed."
        reply = kept
    elif not drew_top and not drew_step and _CLAIMS_FIGURE.search(reply):
        reply = " ".join(s for s in _sentences(reply) if not _CLAIMS_FIGURE.search(s))
        notes.append("No diagram was added.")
    # A problem that points at a figure must have one.
    rewrites = bool(proposal and proposal.get("question"))
    has_figure = drew_top or (not rewrites and bool(item.figure_svg))
    if not has_figure and _FIGURE_REFERENCE.search(question_text or "") and not (top_construction and not drew_top):
        notes.append("This problem refers to a figure, and it doesn't have one yet.")
    return "\n\n".join(filter(None, [reply, *notes])).strip()


def _proposal_has_construction_step(proposal: dict[str, Any] | None) -> bool:
    from api.core.question_bank_generation import _is_construction

    return bool(proposal) and any(
        isinstance(s, dict) and _is_construction(s.get("figure_spec"))
        for s in (proposal or {}).get("solution_steps") or []
    )


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]


# A sentence saying a figure was made or changed: "I added a diagram",
# "I connected B to D", "I've included the diagonal BD", "BD now appears".
_PART = r"(?!(?:SAS|ASA|AAS|SSS|HL|AA|SSA|CPCTC|OK)(?![A-Za-z]))(?:[A-Z][0-9]*'*){2,3}(?![A-Za-z])"
_CLAIMS_FIGURE = re.compile(
    r"\b(?:add(?:ed)?|drew|drawn|draw|includ(?:e|ed)|attach(?:ed)?|label(?:l)?ed|mark(?:ed)?|updat(?:e|ed)|creat(?:e|ed))\b"
    r"[^.!?]*\b(?:diagram|figure|drawing|sketch|picture)s?\b"
    r"|\b(?:diagram|figure|drawing|sketch|picture)s?\b[^.!?]*\b(?:added|drawn|included|attached|updated|created|labell?ed|marked)\b"
    r"|\b(?:connect(?:ed|s)?|join(?:ed|s)?|drew|drawn|add(?:ed)?|includ(?:e|ed|es)|extend(?:ed|s)?|show(?:s|n|ed)?"
    r"|label(?:l)?ed|mark(?:ed)?)\b[^.!?]*"
    rf"(?:(?<![A-Za-z])[A-Z][0-9]*'*\s+(?:and|to|with)\s+[A-Z][0-9]*'*(?![A-Za-z])|(?<![A-Za-z]){_PART}"
    r"|\b(?:diagonals?|segments?|rays?|lines?|angles?)\b)"
    rf"|\b(?:diagonals?|segments?|rays?)\s+{_PART}[^.!?]*\b(?:appears?|drawn|shown|added|included|connects?)\b",
)
