"""Does a question ask the student to DRAW something?

The default for `QuestionBankItem.requires_drawing`: set from the question
text when an item is created (and re-derived when AI rewrites it, unless
a teacher has set it). The flag decides where drawings are USED — the
zoomed verify pass, the grader's required-drawing rule, the review page's
full drawings block. It never decides what is RECORDED: the extractor
inventories drawings on every problem, so a missed flag loses nothing —
the teacher flips it and regrades.

That makes the error costs lopsided, and the classifier leans on purpose:
a false positive costs little (the drawing is checked and shown, and the
teacher can unflag), a false negative costs a grade. So it flags any
drawing-production cue — an imperative "graph / sketch / plot / draw /
shade / construct" anywhere that isn't a noun use, "graphically", "use a
graph", "show / represent / illustrate … on a number line / the
coordinate plane / with a diagram", "make a bar graph / scatter plot /
histogram / table of values", "on your graph".

It does NOT flag the traps that are not requests: a printed figure
("using the graph shown", "in the figure below"), participles ("is
drawn"), "draw a conclusion", completing a printed table, constructing or
sketching a PROOF, a number line used as a coordinate system ("on a
number line, find…"), and drawing an auxiliary segment inside a proof
("draw $\\overline{AD}$. Prove: …").

The migration that backfilled the column carries a frozen copy of this
logic (cp1000085) so a fresh database backfills identically forever.
"""

from __future__ import annotations

import logging
import re
import uuid

_VERB = re.compile(r"\b(graph|sketch|plot|draw|shade|construct)\b", re.IGNORECASE)

# The word before a verb that makes it a noun ("the graph", "a sketch").
_NOUN_BEFORE = {
    "the", "a", "an", "this", "that", "these", "those", "its", "their", "his", "her",
    "given", "following", "bar", "line", "scatter", "dot", "box", "circle", "whose",
    "which",  # a multiple-choice "which graph shows …"
}
# What right after the verb makes it a noun or not-a-drawing.
_NOT_A_REQUEST_AFTER = re.compile(
    r"\s*(?:"
    r"shown|below|above|provided|given|paper|twist|point"
    # probability / games: "draw a card", "draw two marbles"
    r"|(?:a|an|the|one|two|three|four|five|\d+)?\s*(?:red\s+|blue\s+|green\s+)?"
    r"(?:cards?|marbles?|balls?|chips?|tiles?|names?|socks?|tickets?|straws?)\b"
    r"|of\b"  # "the graph of f" (a noun use that slipped past _NOUN_BEFORE)
    r"|(?:a|an|the|your|any|valid)?\s*(?:valid\s+)?(?:conclusions?|inferences?)\b"
    r"|(?:a|an|the)\s+(?:(?:two-column|paragraph|flow(?:chart)?|formal|valid|complete)\s+)?"
    r"(?:proofs?|arguments?|explanations?|statements?)\b"
    r")",
    re.IGNORECASE,
)
_AUX_SEGMENT_AFTER = re.compile(r"\s*\$?\\over(?:line|leftrightarrow|rightarrow)", re.IGNORECASE)
_IS_PROOF = re.compile(r"\bprove\b|\bproof\b", re.IGNORECASE)
# "Solve without graphing", "do not use a graph": a negated request is not one.
# Neither is an optional one: "check by graphing (optional)".
_OPTIONAL = re.compile(r"[^.;:!?]*\(\s*optional\s*\)", re.IGNORECASE)
_NEGATED = re.compile(
    r"\b(?:do\s+not|don'?t|without|no\s+need\s+to|never)\s+"
    r"(?:(?:use|using|make|making|draw|drawing)\s+(?:a|an|any|the)\s+)?"
    r"(?:graph\w*|sketch\w*|plot\w*|draw\w*|shad\w*|number\s+line|diagram)\b",
    re.IGNORECASE,
)

_ALWAYS = [
    re.compile(p, re.IGNORECASE) for p in (
        r"\bgraphically\b",
        r"\bby\s+(?:graphing|sketching|plotting|drawing)\b",
        r"(?:^|[.;:!?]\s*)graphing\s*[:\-]",
        r"\b(?:use|using|with)\s+(?:a|your)\s+(?:graph|number\s+line|diagram|sketch)\b",
        r"\bon\s+your\s+(?:graph|number\s+line|diagram|sketch|coordinate\s+plane|grid)\b",
        r"\b(?:make|create|draw|construct|build|complete|fill\s+in|include|provide)\s+"
        r"(?:a|an|the|your)\s+(?:[a-z\-]+\s+){0,2}"
        r"(?:graph|plot|histogram|chart|diagram|drawing|sketch|number\s+line|table\s+of\s+values)\b",
        r"\b(?:represent|show|illustrate|model|display|depict|indicate|mark)\b[^.;?!]{0,80}?"
        r"\b(?:on|with|using|in)\s+(?:a|an|the|your)\s+"
        r"(?:number\s+line|coordinate\s+(?:plane|grid|axes)|graph|diagram|grid|sketch|table\s+of\s+values)\b",
    )
]


def _verb_is_a_request(text: str, m: re.Match[str]) -> bool:
    before = text[: m.start()].rstrip()
    prev = re.findall(r"[A-Za-z\-]+$", before)
    if prev and prev[0].lower() in _NOUN_BEFORE:
        return False
    after = text[m.end():]
    if _NOT_A_REQUEST_AFTER.match(after):
        return False
    if m.group(1).lower() in ("draw", "construct") and _AUX_SEGMENT_AFTER.match(after):
        # Drawing a named segment is a proof's auxiliary construction —
        # unless the problem is a construction task, not a proof.
        return not _IS_PROOF.search(text)
    return True


def requires_drawing(question: str | None) -> bool:
    """True when the question asks the student to produce a drawing."""
    if not question:
        return False
    text = _OPTIONAL.sub(" ", _NEGATED.sub(" ", " ".join(question.split())))
    if any(p.search(text) for p in _ALWAYS):
        return True
    return any(_verb_is_a_request(text, m) for m in _VERB.finditer(text))


# ── The AI call (the primary source; the regex above is its fallback) ──
#
# Founder decision (PR #907): the flag is derived by AI when a problem is
# created and only again when its question TEXT changes (and no teacher
# has set it). Generated and uploaded items get it free from the call
# that wrote/read the question (GENERATE_QUESTIONS_SCHEMA); regeneration
# from REGENERATE_QA_SCHEMA. Text nobody's AI call produced — a teacher's
# edit, an accepted Workshop rewrite — goes through this one small call,
# run AFTER the save so the teacher never waits on it (the regex value is
# stored immediately). Never called while grading or extracting: those
# only read the stored column.

logger = logging.getLogger(__name__)

_CLASSIFY_SYSTEM = (
    "Decide whether this homework question asks the STUDENT to produce a drawing: "
    "a graph, plot, sketch, number line, diagram, data display (bar graph, "
    "histogram, scatter plot, …) or geometric construction. Answer false when the "
    "drawing is a printed figure the student only reads (\"using the graph shown\"), "
    "a multiple-choice \"which graph …\", negated (\"do not graph\"), optional "
    "(\"check by graphing (optional)\"), an auxiliary line inside a proof, or "
    "\"draw\" in another sense (\"draw a card\", \"draw a conclusion\")."
)


async def _llm_requires_drawing(question: str, *, user_id: str | None = None) -> bool | None:
    """One cheap classification call; None when it fails or answers oddly."""
    from api.core.llm_client import MODEL_CLASSIFY, LLMMode, call_claude_json
    from api.core.llm_schemas import REQUIRES_DRAWING_SCHEMA

    try:
        result = await call_claude_json(
            _CLASSIFY_SYSTEM,
            question,
            LLMMode.CLASSIFY_REQUIRES_DRAWING,
            tool_schema=REQUIRES_DRAWING_SCHEMA,
            model=MODEL_CLASSIFY,
            max_tokens=64,
            temperature=0.0,
            user_id=user_id,
        )
    except Exception:  # noqa: BLE001 — the regex is the fallback
        logger.warning("requires-drawing classification failed; using the regex", exc_info=True)
        return None
    flag = result.get("requires_drawing") if isinstance(result, dict) else None
    return flag if isinstance(flag, bool) else None


async def classify_requires_drawing(question: str, *, user_id: str | None = None) -> bool:
    """The AI's answer, or the regex classifier when the call fails."""
    flag = await _llm_requires_drawing(question, user_id=user_id)
    return requires_drawing(question) if flag is None else flag


async def refresh_requires_drawing(
    item_id: uuid.UUID, question: str, *, user_id: str | None = None,
) -> None:
    """After a question-text change: ask the AI, then store its answer —
    only if the text is still the one it judged and no teacher has set
    the flag since. Runs as a background task, off the teacher's save."""
    from sqlalchemy import select

    from api.database import get_session_factory
    from api.models.question_bank import QuestionBankItem

    flag = await _llm_requires_drawing(question, user_id=user_id)
    if flag is None:
        return  # the regex value stored at save time stands
    async with get_session_factory()() as s:
        item = (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == item_id)
        )).scalar_one_or_none()
        if item is None or item.question != question or item.requires_drawing_teacher_set:
            return
        if item.requires_drawing != flag:
            item.requires_drawing = flag
            await s.commit()
