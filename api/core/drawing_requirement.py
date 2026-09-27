"""Does a question ask the student to DRAW something?

The single source for `QuestionBankItem.requires_drawing` at creation and
backfill. Drawings only matter for grading on problems that require one,
so this flag gates the whole drawings channel: the extractor inventories
drawings only on flagged problems, and the grader's required-drawing rule
reads the flag instead of re-deriving it from wording.

Deterministic on purpose. Evaluated against every question in the prod
bank (92, Sep 2026): 3 true positives, 0 false positives, 0 misses, with
the traps that matter all present in real questions — "a diagonal is
drawn", "if a figure is a square", "on a number line, find…", "in the
figure below", "draw $\\overline{AD}$" as a proof's auxiliary line, "use
the Law of Detachment to draw a conclusion", and "copy and complete the
table below" in a two-column proof. An LLM-set flag would be one more
probabilistic output to verify; this is $0, reproducible, and identical
for generated, uploaded, manually created, and backfilled items. The
teacher can override it per question in the Workshop.

What counts: an imperative to graph / sketch / plot / draw / shade /
construct (at a sentence or list-item start, or after "and"/"then"),
"by graphing", and making a table of values. What doesn't: the noun
"graph" ("using the graph shown"), past participles ("is drawn"),
"draw a conclusion", drawing an auxiliary segment in a proof, and
completing a printed table.
"""

from __future__ import annotations

import re

# Where an imperative can start: the beginning, after sentence/clause
# punctuation, after a list marker "(a)" / "a)" / "1.", or after a
# connective ("…and graph it", "then sketch…").
_LEAD = r"(?:^|[.;:!?]\s*|\(\w{1,3}\)\s*|\b\w{1,3}\)\s*|\b(?:and|then|also|please)\s+)"

_VERB = r"(?:graph|sketch|plot|draw|shade|construct)"

# Objects that make the verb NOT a drawing request.
_NOT_A_DRAWING = (
    # "draw a conclusion", "draw an inference"
    r"(?:a|an|the|your|any)?\s*(?:valid\s+)?(?:conclusions?|inferences?)\b"
    # an auxiliary segment / ray / line named in LaTeX — part of a proof's
    # setup ("draw $\overline{AD}$"), not a figure the grader should require
    r"|\$\\over(?:line|leftrightarrow|rightarrow)"
    # "construct a proof / an argument / a two-column proof"
    r"|(?:a|an|the)\s+(?:(?:two-column|paragraph|flow(?:chart)?|formal|valid)\s+)?"
    r"(?:proofs?|arguments?|explanations?|statements?)\b"
)

_IMPERATIVE = re.compile(
    rf"{_LEAD}{_VERB}\b(?!\s+(?:{_NOT_A_DRAWING}))", re.IGNORECASE,
)
_BY_GRAPHING = re.compile(r"\bby\s+(?:graphing|sketching|plotting)\b", re.IGNORECASE)
_TABLE_OF_VALUES = re.compile(
    r"\b(?:make|create|complete|fill\s+in|build)\s+(?:a|an|the|your)\s+table\s+of\s+values\b",
    re.IGNORECASE,
)
_MAKE_A_DRAWING = re.compile(
    r"\b(?:make|include|provide)\s+(?:a|an)\s+(?:drawing|sketch|diagram|graph)\b",
    re.IGNORECASE,
)


def requires_drawing(question: str | None) -> bool:
    """True when the question asks the student to produce a drawing."""
    if not question:
        return False
    text = " ".join(question.split())
    return bool(
        _BY_GRAPHING.search(text)
        or _IMPERATIVE.search(text)
        or _TABLE_OF_VALUES.search(text)
        or _MAKE_A_DRAWING.search(text)
    )
