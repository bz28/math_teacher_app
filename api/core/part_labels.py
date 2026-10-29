"""Practice problems ask for exactly one answer.

A practice problem with lettered parts — "(a) find x, (b) name the
theorem" — cannot be a fair multiple-choice question. Its wrong options
answer one part while the right one answers all of them, so the longest
choice gives itself away. Generation is told to write one answer per
problem (`PRACTICE_SINGLE_ANSWER_RULE`), and `has_part_labels` is the
deterministic backstop: an item that still has parts, whether the model
slipped or a teacher uploaded or wrote it that way, gets no wrong
options and is practiced as free response.

Homework may still be multi-part; none of this applies to it.
"""

from __future__ import annotations

import re

PRACTICE_SINGLE_ANSWER_RULE = (
    "Each problem asks for exactly one final answer: one value, one "
    "expression, one equation, or one short statement. Do not split a "
    "problem into lettered or numbered sub-parts such as (a)/(b), a)/b), "
    "or Part A/Part B, and do not ask for two things in one problem "
    "(\"find x and the measure of each angle\"). Write a second problem "
    "instead."
)

# A label is a letter a-h or a roman numeral i-iv.
_LABEL = r"[a-h]|iv|i{1,3}"

# "(a)" standing on its own as a label: at the start, or after whitespace,
# markdown bold, or a math delimiter — "(a) Find", "**(a)**", "$(a)$".
# Not after a letter, digit, or bracket, so f(a), g(b), x(a)(b) and
# \left(a\right) are function calls, not labels. Only a single letter
# fits between the brackets, so the interval (a, b) never matches, and
# digits never do, so "(1)" naming an equation is left alone.
_PAREN = re.compile(
    rf"(?:^|(?<=[\s*$>]))\(\s*({_LABEL})\s*\)(?=[\s*$:.,\\]|$)",
    re.IGNORECASE,
)

# "a)" / "a." opening a line: "a) Find", "**b.** Name". Line starts only —
# mid-sentence "a." is just the end of a sentence about a.
_LINE = re.compile(
    rf"^[ \t>*-]*({_LABEL})[).](?:\*\*)?[ \t]",
    re.IGNORECASE | re.MULTILINE,
)

# "Part A" / "Part (b)" / "Part 2".
_PART = re.compile(
    rf"\bpart\s+\(?({_LABEL}|[1-9])\)?(?=[\s:.,)*]|$)",
    re.IGNORECASE,
)

# A problem has parts when it labels at least a first AND a second one.
# One "(a)" alone is too weak: it is far more often a stray variable than
# a part, and a real multi-part problem always has a second part.
_PAIRS = ({"a", "b"}, {"i", "ii"}, {"1", "2"})


def has_part_labels(text: str | None) -> bool:
    """True when `text` is split into labeled sub-parts."""
    if not text:
        return False
    labels = {m.lower() for rx in (_PAREN, _LINE, _PART) for m in rx.findall(text)}
    return any(pair <= labels for pair in _PAIRS)


def is_multi_part(question: str | None, final_answer: str | None) -> bool:
    """True when either the problem or its answer has labeled parts."""
    return has_part_labels(question) or has_part_labels(final_answer)
