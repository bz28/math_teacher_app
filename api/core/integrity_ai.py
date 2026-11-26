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

import asyncio
import logging
import re
import uuid
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core import photo_store
from api.core.image_utils import (
    crop_region_for_vision,
    pdf_pages_as_images,
    prepare_page_for_reader,
    to_content_block,
)
from api.core.llm_client import (
    MODEL_HAIKU,
    MODEL_OPUS,
    MODEL_REASON,
    LLMMode,
    TextDeltaCallback,
    call_claude_conversation,
    call_claude_json,
    call_claude_vision,
)
from api.core.llm_schemas import (
    INTEGRITY_DIAGNOSE_WRONG_SCHEMA,
    INTEGRITY_EXTRACT_SCHEMA,
    INTEGRITY_FINISH_CHECK_SCHEMA,
    INTEGRITY_GENERATE_VARIANT_SCHEMA,
    INTEGRITY_LABEL_REPLY_SCHEMA,
    INTEGRITY_SUBMIT_VERDICT_SCHEMA,
    VISUAL_WORK_VERIFY_SCHEMA,
)
from api.core.prompts import load_prompt, load_prompt_map
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

_EXTRACT_SYSTEM = load_prompt("integrity_extract_system")


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
        return {"steps": [], "final_answers": [], "visual_work": [], "confidence": 0.0}

    return await extract_student_work_from_pages(
        files, problems=problems, user_id=user_id, submission_id=submission_id,
    )


async def extract_student_work_from_pages(
    files: list[Any],
    *,
    problems: list[dict[str, Any]] | None = None,
    user_id: str | None = None,
    submission_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Read pages that are already in hand. Split out from
    `extract_student_work` so the reader can be exercised on a page
    without a submission row behind it — the fidelity probe
    (`tests/harness/probes/extraction_fidelity.py`) draws its own pages
    with known ground truth, which is the only way to assert that the
    transcript says what the ink says.

    `files` are stored page entries (`photo_store`): each page's bytes are
    fetched from the photo bucket here, at full resolution — the drawing
    check below crops from the original pixels.
    """
    files = await photo_store.load_pages(files)

    briefing = _format_problems_briefing(problems)
    instruction = (
        "Extract the student's handwritten work from this homework submission. "
        "Pages are sent in order, each preceded by a '--- Page N of M ---' "
        "marker — treat them as one document so work that spans pages "
        "stitches across cleanly. List each step the student wrote, in "
        "order, and tag each step with the problem_position it belongs to "
        "and the page_index (the N from the marker above it) it was written "
        "on. Extract each problem's final answer when the student wrote one, "
        "tagged the same way. Record every drawing (graph, number line, "
        "diagram, table, sketch) in visual_work, and a present=false entry "
        "for any problem that asked for a drawing and has none."
    )

    content: list[dict[str, Any]] = []
    for page_number, f in enumerate(files, start=1):
        raw = f.get("data", "")
        recorded_media = f.get("media_type", "image/jpeg")
        base64_data, media_type = _strip_data_url_prefix(raw, recorded_media)
        # EXIF-orient + fit to the reader's native resolution. Resampling
        # a page to ~3.75 MP is CPU work: keep it off the event loop.
        parts = [await asyncio.to_thread(prepare_page_for_reader, base64_data, media_type)]
        if media_type == "application/pdf":
            # Sent as a document, a PDF page is rasterized by the API at a
            # fixed ~1.2 MP, so a photo printed to PDF reached the reader
            # far smaller than the photo itself. Its pages go as images we
            # render, cut to the work (`pdf_pages_as_images`). A PDF we
            # can't render in full (unreadable, past the page cap, a page
            # that fails) still goes as a document: never fewer pages than
            # before. A typed PDF's text layer isn't sent — its rendered
            # text reads as well.
            rendered = await asyncio.to_thread(_pdf_pages_for_vision, base64_data)
            if rendered:
                parts = rendered
            else:
                logger.warning("extract: PDF file %d not rendered in full, sent as a document", page_number)
        # Label every page before its image. Without this, asking the
        # model for a `page_index` would be asking it to count ordinal
        # image positions with nothing to count against — the blocks are
        # otherwise indistinguishable. With it, attribution is reading
        # back a label it was just handed, which is what makes the field
        # worth trusting enough to render. A PDF's pages are parts of its
        # file's one page number, as `graph_grading.page_images` has them.
        for part, (data, part_media_type) in enumerate(parts, start=1):
            of_parts = f", part {part} of {len(parts)}" if len(parts) > 1 else ""
            content.append({
                "type": "text",
                "text": f"--- Page {page_number} of {len(files)}{of_parts} ---",
            })
            content.append(to_content_block(part_media_type, data))
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
    # 4096 was NOT comfortable headroom. On 2026-09-04 a real 2-page,
    # 10-problem Holy Ghost Prep submission truncated at exactly 4096
    # and stranded the student again — the same failure this comment
    # was written about, one order of magnitude up. Raised to 16384.
    #
    # This cap is nearly free to raise: output tokens are billed as
    # produced, not as reserved, so a bigger ceiling costs nothing until
    # a submission actually needs it. The asymmetry is stark — too low
    # silently strands a student's homework with no retry path, too high
    # costs a few cents on the densest page. Size it for the worst real
    # submission, not the median one.
    # Opus reads handwriting far better than Sonnet (2 reading errors to
    # 30 on 50 of the hardest real problems), but it always thinks, so it
    # can't be pinned to temperature 0: two reads of the same photo can
    # differ. The grade stays reproducible because the read is stored and
    # a regrade reuses it (test_regrade_reuses_extraction). Its thinking
    # counts toward max_tokens, hence the larger cap.
    result = await call_claude_vision(
        content,
        LLMMode.INTEGRITY_EXTRACT,
        tool_schema=INTEGRITY_EXTRACT_SCHEMA,
        # Until 2026-09 this prompt was written, tested, and never sent:
        # `call_claude_vision` had no system-prompt parameter, so the
        # extractor ran on the safety preamble and the tool schema alone.
        # Every behavioural rule here was dead — "transcribe, don't solve",
        # the injection guard, "ignore printed worksheet text", and the
        # below-0.3-confidence rule for illegible pages. A real misread in
        # prod (a student's `y = x` transcribed as the worksheet's
        # `y = √x`) is what surfaced it.
        system_prompt=_EXTRACT_SYSTEM,
        model=MODEL_OPUS,
        max_tokens=32000,
        user_id=user_id,
        submission_id=str(submission_id) if submission_id else None,
        call_metadata={"phase": "vision_extract"},
        prompt_ids=("integrity_extract_system",),
    )
    # Every drawing is RECORDED (a missed requires_drawing flag must be
    # recoverable by flipping it and regrading); only the ones the grader
    # will use get the zoomed second look.
    await verify_visual_work(
        result, files, user_id=user_id,
        submission_id=str(submission_id) if submission_id else None,
        flagged_positions={
            p.get("position") for p in problems or []
            if isinstance(p, dict) and p.get("requires_drawing")
        },
    )
    return result


def _pdf_pages_for_vision(data_base64: str) -> list[tuple[str, str]]:
    """A PDF's pages as the reader gets them: rendered at the reader's
    long edge and cut to the work, then fitted like a photo. CPU-bound —
    run it off the event loop."""
    return [
        prepare_page_for_reader(page, "image/jpeg")
        for page in pdf_pages_as_images(data_base64, complete=True)
    ]


_VERIFY_PROMPT = load_prompt("integrity_verify_crop")


async def verify_visual_work(
    extraction: dict[str, Any],
    files: list[Any],
    *,
    user_id: str | None = None,
    submission_id: str | None = None,
    flagged_positions: set[Any] | None = None,
) -> None:
    """Second look at each drawing the grader will use: present, on a
    problem that requires a drawing (`flagged_positions`), not a table.

    The full-page pass is primed: it reads "y = 2x - 1, y = -x + 5" next to
    a sketch and reports two lines plotted when one is — even under a
    neutral prompt, because at page resolution a 2-inch graph is a blur
    and the algebra fills it in. Cropped and enlarged, the same model
    counts strokes correctly (measured on the Sep 2026 prod submission
    that started this: full page → "2 lines", crop → "1 line, 2 dots").

    So each present drawing with a usable bbox gets one small, context-
    free vision call on its crop. When the crop counts a different number
    of drawn lines, what it says REPLACES the inventory the grader will
    read (`plotted_elements`, `labeled_points`, `answer_on_drawing`); when
    it agrees, the count is confirmed and the first read's richer
    descriptions stand (see `_verify_one`). `verified` records which happened, so the
    teacher UI can tell a checked inventory from a claimed one. When
    both crops find no drawing at all, the inventory is emptied and the
    entry is marked `unconfirmed` (never `verified`). Failures keep the
    unverified entry — a report is better than none — and never fail
    the extraction.
    """
    flagged = flagged_positions or set()
    entries = [
        v for v in (extraction.get("visual_work") or [])
        if isinstance(v, dict) and v.get("problem_position") in flagged
    ]
    for v in entries:
        if v.get("present"):
            v.setdefault("verified", False)
    # A table is text in a grid, and the zoomed look is told to ignore
    # text — it can only ever answer "no drawing". So tables are never
    # sent: they stay unverified (shown neutrally), never "unconfirmed".
    # Bounded and concurrent: this runs on the student's path to the
    # confirm screen, so a page with many sketches must not turn into a
    # long serial chain of vision calls. Past the cap, entries stay as
    # the first pass reported them (verified=False says so).
    candidates = [
        v for v in entries if v.get("present") and v.get("kind") != "table"
    ][:_VERIFY_MAX_DRAWINGS]
    sem = asyncio.Semaphore(_VERIFY_CONCURRENCY)

    async def _one(v: dict[str, Any]) -> None:
        async with sem:
            try:
                await _verify_one(v, files, user_id=user_id, submission_id=submission_id)
            except Exception:  # noqa: BLE001 — the extraction must land regardless
                logger.exception(
                    "visual_work verify crashed submission=%s position=%s",
                    submission_id, v.get("problem_position"),
                )

    await asyncio.gather(*(_one(v) for v in candidates))


_VERIFY_MAX_DRAWINGS = 6
_VERIFY_CONCURRENCY = 3


async def _verify_one(
    v: dict[str, Any],
    files: list[Any],
    *,
    user_id: str | None,
    submission_id: str | None,
) -> None:
    """One drawing's second look; mutates `v` in place. See verify_visual_work."""
    page = v.get("page_index")
    if not isinstance(page, int) or isinstance(page, bool):
        page = 1 if len(files) == 1 else None
    bbox = v.get("bbox")
    if page is None or not (1 <= page <= len(files)) or not isinstance(bbox, dict):
        return
    f = files[page - 1]
    raw = f.get("data", "")
    base64_data, media_type = _strip_data_url_prefix(raw, f.get("media_type", "image/jpeg"))
    # The model's boxes are rough — off by a tenth of the page is
    # normal. A crop that shows no drawing gets one wider retry
    # before we believe it.
    seen: Any = None
    for margin in (0.35, 0.8):
        crop = crop_region_for_vision(base64_data, media_type, bbox, margin=margin)
        if crop is None:
            # Can't take the (wider) look — don't let a single
            # "nothing here" from the narrower crop stand as verified.
            seen = None
            break
        try:
            seen = await call_claude_vision(
                [to_content_block("image/jpeg", crop), {"type": "text", "text": _VERIFY_PROMPT}],
                LLMMode.INTEGRITY_EXTRACT,
                tool_schema=VISUAL_WORK_VERIFY_SCHEMA,
                model=MODEL_REASON,
                max_tokens=1500,
                temperature=0.0,
                user_id=user_id,
                submission_id=submission_id,
                call_metadata={
                    "phase": "vision_verify_drawing",
                    "problem_position": v.get("problem_position"),
                    "margin": margin,
                },
                prompt_ids=("integrity_verify_crop",),
            )
        except Exception:  # noqa: BLE001 — verification is best-effort
            logger.exception("visual_work verify failed submission=%s", submission_id)
            seen = None
            break
        if isinstance(seen, dict) and seen.get("has_drawing", True):
            break
    if not isinstance(seen, dict):
        return
    if not seen.get("has_drawing", True):
        # Two crops around the reported spot show no drawing. Don't
        # flip `present` on a possibly-bad box, and don't erase what the
        # first read recorded (an inventory is never replaced with an
        # empty one). This is NOT a confirmation — `unconfirmed` records
        # the failed look: the grader formatter withholds the whole
        # inventory ("credit nothing from it"), and the teacher sees
        # "couldn't confirm" with the first read framed as a claim.
        v["verified"] = False
        v["unconfirmed"] = True
        v["unconfirmed_reason"] = UNCONFIRMED_NOT_FOUND
        return
    raw_elements = seen.get("elements")
    typed = [
        e for e in (raw_elements if isinstance(raw_elements, list) else [])
        if isinstance(e, dict) and e.get("type") not in (None, "axis", "other")
    ]
    raw_points = seen.get("labeled_points")
    seen_points = [
        pt for pt in (raw_points if isinstance(raw_points, list) else [])
        if isinstance(pt, str) and pt.strip()
    ]
    # The answer on the drawing is NOT checked here: the crop has no
    # problem text, so it can't know a shaded ray is "the answer" — the
    # first read (which has the question) stays its source (case d).
    # Labeled points ARE checkable context-free on a coordinate graph (a
    # coordinate written beside a point). A disagreement there is a doubt,
    # not a correction: the entry is marked unconfirmed for the teacher,
    # never rewritten. Only on a graph: a number line's tick labels or a
    # diagram's vertex names read as "labels" on one side and not the
    # other (eval case d: first read ["4"], crop []), which would raise a
    # false doubt on a drawing this pass never checks.
    if v.get("kind") == "graph" and not _same_marks(v.get("labeled_points"), seen_points):
        v["verified"] = False
        v["unconfirmed"] = True
        v["unconfirmed_reason"] = UNCONFIRMED_POINTS_DISAGREE
        v["zoomed_labeled_points"] = seen_points
        return
    # The two reads can only be compared on the same basis. The first
    # read's `plotted_elements` are untyped text; the crop's are typed.
    # The one comparison that is sound is the one the second look exists
    # for: a GRAPH whose crop shows only lines/curves (no points, shading,
    # rays or segments), where "how many lines are drawn" means the same
    # thing on both sides (#902: one line drawn, both equations written,
    # first read "2 lines"). Anything else — plotted points, a shaded
    # inequality, a number line, a triangle's three segments — would
    # compare different things (2 points vs 0 lines; "triangle ABC" vs 3
    # segments), so the first read stands, honestly unchecked.
    lines = [e for e in typed if e.get("type") in _GRAPH_PLOTTED_TYPES]
    # A marked point (a circled intersection) doesn't change what "lines"
    # means, so points are allowed alongside lines — they just aren't
    # counted, on either side. Shading, rays and segments are not.
    comparable = (
        v.get("kind") == "graph"
        and bool(lines)
        and all(e.get("type") in _GRAPH_PLOTTED_TYPES | {"point"} for e in typed)
    )
    if not comparable:
        return  # verified stays False: shown and graded as the full-page read
    first_count = len([
        e for e in (v.get("plotted_elements") or [])
        if isinstance(e, str) and e.strip() and not _names_only_a_point(e)
    ])
    # Only the COUNT (and the labeled points above) is checked. When it
    # agrees, the first read's descriptions stand — it saw the whole page;
    # the context-free crop describes wobbly strokes as "curves" (eval a).
    v["verified"] = True
    v["verified_scope"] = VERIFIED_COUNT
    if len(lines) == first_count:
        return
    # Counts differ: the crop's lines replace the inventory. Never empty —
    # `comparable` requires at least one line on the crop.
    v["plotted_elements"] = [str(e.get("description") or e.get("type")).strip() for e in lines]
    desc = seen.get("description")
    if isinstance(desc, str) and desc.strip():
        v["description"] = desc.strip()


_GRAPH_PLOTTED_TYPES = frozenset({"line", "curve"})
# Why an entry is unconfirmed (shown to the teacher, told to the grader).
# Rows written before the reason existed carry none and mean NOT_FOUND.
UNCONFIRMED_NOT_FOUND = "not_found"
UNCONFIRMED_POINTS_DISAGREE = "labeled_points_disagree"
# What a `verified` entry had checked: the number of lines drawn (and
# the labeled points) — never the line descriptions themselves.
VERIFIED_COUNT = "count"

_COORD = re.compile(r"\(([^()]*)\)")
_POINT_WORD = re.compile(r"\b(?:point|dot)s?\b", re.IGNORECASE)
_LINE_WORD = re.compile(r"\b(?:line|curve|parabola|ray|graph)s?\b", re.IGNORECASE)


def _names_only_a_point(element: str) -> bool:
    """A first-read element that is a plotted point, not a line ("point
    A(1, 2)", "circled dot at the intersection") — excluded from the line
    count so both sides count the same thing."""
    return bool(_POINT_WORD.search(element)) and not _LINE_WORD.search(element)


def _same_marks(first: Any, seen: list[Any]) -> bool:
    """Do two readings of labeled points say the same thing? Compares the
    coordinates only, ignoring spacing and any label in front:
    `A(1, 2)`, `(1,2)` and `A (1,2)` are the same mark."""
    def norm(xs: Any) -> list[str]:
        out = []
        for x in xs or []:
            if not isinstance(x, str) or not x.strip():
                continue
            coords = _COORD.findall(x)
            text = ",".join(coords) if coords else x
            out.append("".join(text.split()).lower())
        return sorted(out)
    return norm(first) == norm(seen)


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
POSTURE_PROMPT_FRAGMENTS: dict[str, str] = load_prompt_map("integrity_posture_fragments")


# {student_signal} is filled by build_agent_system_prompt with one of
# POSTURE_PROMPT_FRAGMENTS above. Any other literal `{...}` token in
# this string would crash str.format — escape with `{{ }}` if needed.
AGENT_SYSTEM_PROMPT = load_prompt("integrity_agent_system")


AGENT_TOOL_SCHEMAS = [
    INTEGRITY_LABEL_REPLY_SCHEMA,
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
        every problem. Always populated for approved items (enforced
        by the approve endpoint + NOT NULL on QuestionBankItem).
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


class _AgentContentBlock:
    """Attribute-accessible view over one serialized content block.

    `call_claude_conversation` returns JSON-native dicts (so the harness
    cassette can round-trip them); the agent loop in
    `integrity_pipeline` reads blocks via `getattr(b, "type"/"text"/
    "name"/"id"/"input")`. This thin wrapper exposes exactly those
    attributes so the pipeline is identical whether the turn was a live
    Claude call or a $0 cassette replay — no `isinstance` coupling to
    the SDK's block classes anywhere downstream.
    """

    __slots__ = ("type", "text", "id", "name", "input")

    def __init__(self, block: dict[str, Any]) -> None:
        self.type = block.get("type")
        self.text = block.get("text", "")
        self.id = block.get("id", "")
        self.name = block.get("name", "")
        self.input = block.get("input", {})


async def run_agent_turn(
    system_prompt: str,
    messages: list[dict[str, Any]],
    *,
    user_id: str | None = None,
    submission_id: str | None = None,
    call_metadata: dict[str, Any] | None = None,
    on_text: TextDeltaCallback | None = None,
) -> list[Any]:
    """One Claude round trip for the conversational integrity agent.

    Returns the assistant's content blocks as `_AgentContentBlock`
    views (text + tool_use). The caller walks the blocks: for tool_use
    blocks it must validate, apply side effects, and reply with
    tool_result messages; then call this again until the model returns
    text without any tool_use.

    `temperature=0.0` pins the verdict so an identical transcript yields
    the same disposition on every run — the precondition for measuring a
    judgment change (the integrity eval harness) rather than chasing
    sampling noise. The Vision read upstream is not temp-0 (Opus always
    thinks), but it is read once and stored, so the transcript this sees
    is fixed.

    `submission_id` and `call_metadata` are forwarded to the LLM-call
    log so the admin dashboard can correlate the agent's calls with
    the rest of the submission's pipeline (Vision, equivalence,
    grading) and surface posture/turn context as debug chips.

    `on_text` streams the response's text deltas as they're written
    (see `call_claude_conversation`); the return value is unchanged.
    """
    blocks = await call_claude_conversation(
        system_prompt,
        messages,
        LLMMode.INTEGRITY_AGENT,
        tool_schemas=AGENT_TOOL_SCHEMAS,
        user_id=user_id,
        model=MODEL_REASON,
        max_tokens=AGENT_MAX_TOKENS_PER_TURN,
        temperature=0.0,
        submission_id=submission_id,
        call_metadata=call_metadata,
        on_text=on_text,
        prompt_ids=("integrity_agent_system", "integrity_posture_fragments", "integrity_opener_templates"),
    )
    return [_AgentContentBlock(b) for b in blocks]


# ── Silent per-wrong-problem diagnosis ──────────────────────────────

DIAGNOSE_WRONG_SYSTEM_PROMPT = load_prompt("integrity_diagnose_wrong_system")


def build_diagnose_wrong_user_message(
    *,
    problem_statement: str,
    correct_answer: str,
    canonical_steps: list[Any] | None,
    student_steps: list[dict[str, Any]],
    student_final_answer: str,
) -> str:
    """Render the user message for one silent diagnosis call.

    `canonical_steps` is the bank item's `solution_steps` JSON (list of
    arbitrary dicts) or None when the item didn't ship with one — the
    prompt adapts by omitting that section instead of rendering empty
    bullets that would confuse the model. `student_steps` is the
    pre-sliced extraction.steps for this problem.
    """
    lines: list[str] = [
        "Problem:",
        problem_statement.strip() or "(problem text unavailable)",
        "",
        "Correct final answer:",
        correct_answer.strip() or "(none recorded)",
    ]

    if canonical_steps:
        lines.append("")
        lines.append("Canonical solution steps (reference):")
        for idx, raw in enumerate(canonical_steps, start=1):
            if isinstance(raw, dict):
                # Bank items vary on which fields populate; prefer the
                # human-readable description when present, fall back to
                # whatever string field exists.
                text = (
                    raw.get("description")
                    or raw.get("text")
                    or raw.get("plain_english")
                    or raw.get("latex")
                    or ""
                )
            else:
                text = str(raw)
            text = text.strip()
            if text:
                lines.append(f"  {idx}. {text}")

    lines.append("")
    lines.append("Student's written work for this problem:")
    if student_steps:
        for s in student_steps:
            step_num = s.get("step_num", "?")
            plain = (s.get("plain_english") or "").strip()
            latex = (s.get("latex") or "").strip()
            if plain and latex:
                lines.append(f"  Step {step_num}: {plain} [{latex}]")
            elif plain or latex:
                lines.append(f"  Step {step_num}: {plain or latex}")
            else:
                lines.append(f"  Step {step_num}: (unreadable)")
    else:
        lines.append("  (no legible steps)")

    final = student_final_answer.strip()
    lines.append("")
    lines.append(
        f"Student's final answer: {final or '(none extracted)'}",
    )
    lines.append("")
    lines.append(
        "Diagnose the misunderstanding and classify the kind. Return via "
        "the tool call."
    )
    return "\n".join(lines)


async def diagnose_wrong_problem(
    *,
    problem_statement: str,
    correct_answer: str,
    canonical_steps: list[Any] | None,
    student_steps: list[dict[str, Any]],
    student_final_answer: str,
    user_id: str | None = None,
    submission_id: str | None = None,
    call_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """One Haiku call producing a misconception note + kind for a single
    problem the student got wrong. Cost ≈ $0.003 per call. Caller fans
    these out with asyncio.gather over wrong problems; per-call failures
    are caught at the pipeline layer (return_exceptions=True) and that
    row is marked kind='error'.

    Returns the parsed tool-call output: `{"note": str, "kind": str}`
    where kind is one of "procedural_slip" or "conceptual_gap" (the
    pipeline owns "blank"/"unreadable"/"error" sentinels).
    """
    user_message = build_diagnose_wrong_user_message(
        problem_statement=problem_statement,
        correct_answer=correct_answer,
        canonical_steps=canonical_steps,
        student_steps=student_steps,
        student_final_answer=student_final_answer,
    )
    return await call_claude_json(
        system_prompt=DIAGNOSE_WRONG_SYSTEM_PROMPT,
        user_message=user_message,
        mode=LLMMode.INTEGRITY_DIAGNOSE_WRONG,
        tool_schema=INTEGRITY_DIAGNOSE_WRONG_SCHEMA,
        user_id=user_id,
        model=MODEL_HAIKU,
        submission_id=submission_id,
        call_metadata=call_metadata,
        prompt_ids=("integrity_diagnose_wrong_system",),
    )
