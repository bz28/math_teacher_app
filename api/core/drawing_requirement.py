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

import re

_VERB = re.compile(r"\b(graph|sketch|plot|draw|shade|construct)\b", re.IGNORECASE)

# The word before a verb that makes it a noun ("the graph", "a sketch").
_NOUN_BEFORE = {
    "the", "a", "an", "this", "that", "these", "those", "its", "their", "his", "her",
    "given", "following", "bar", "line", "scatter", "dot", "box", "circle", "whose",
}
# What right after the verb makes it a noun or not-a-drawing.
_NOT_A_REQUEST_AFTER = re.compile(
    r"\s*(?:"
    r"shown|below|above|provided|given|paper|twist|point"
    r"|of\b"  # "the graph of f" (a noun use that slipped past _NOUN_BEFORE)
    r"|(?:a|an|the|your|any|valid)?\s*(?:valid\s+)?(?:conclusions?|inferences?)\b"
    r"|(?:a|an|the)\s+(?:(?:two-column|paragraph|flow(?:chart)?|formal|valid|complete)\s+)?"
    r"(?:proofs?|arguments?|explanations?|statements?)\b"
    r")",
    re.IGNORECASE,
)
_AUX_SEGMENT_AFTER = re.compile(r"\s*\$?\\over(?:line|leftrightarrow|rightarrow)", re.IGNORECASE)
_IS_PROOF = re.compile(r"\bprove\b|\bproof\b", re.IGNORECASE)

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
    text = " ".join(question.split())
    if any(p.search(text) for p in _ALWAYS):
        return True
    return any(_verb_is_a_request(text, m) for m in _VERB.finditer(text))
