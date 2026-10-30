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
    "This rule overrides every other instruction, including the teacher's "
    "and any reference question: each problem asks for exactly one final "
    "answer — one value, one expression, one equation, or one short "
    "statement — even if those instructions ask for parts. Do not split a "
    "problem into lettered or numbered sub-parts such as (a)/(b), a)/b), "
    "1./2., or Part A/Part B, and do not ask for two things in one problem "
    "(\"find x and the measure of each angle\"). Write a second problem "
    "instead."
)

# A label only counts where a part label stands: opening a line or a
# sentence. Mid-sentence, "(i) and (ii)", "copper (I) oxide", "x = (a) +
# (b)" and "(A) 3 (B) 4" name or list things; they are not parts.
_LABEL = r"[a-h]|iv|i{1,3}|[1-9]"
# Line or sentence start, then optional list/markdown/math lead-in.
_LEAD = r"(?:^|(?<=[.?!:;]))[ \t]*(?:[>*-][ \t]*)*(?:\*\*|\$)?"

# "(a) Find…", "**(b)** …", "$(c)$ …", "(i) …", "(A) …", "(1) Find…".
_PAREN = re.compile(
    rf"{_LEAD}\(({_LABEL})\)(?=\**\$?[:.]?\s*\S)", re.IGNORECASE | re.MULTILINE,
)
# "a) Find…", "**b.** Name…", "1. Find…" — line starts only: mid-sentence
# "a." just ends a sentence about a.
_BARE = re.compile(
    rf"^[ \t>*-]*(?:\*\*)?({_LABEL})[).](?:\*\*)?[ \t]+(?=\S)", re.IGNORECASE | re.MULTILINE,
)
# "(a)Find x(b)Find y" — a label glued to the capitalised start of its part.
_GLUED = re.compile(r"\(([a-h])\)(?=[A-Z])")
# "Part A: …", "**Part (b)** …", "Part 2." — at a line start, or closed
# by : . ) — so "in part 1 of its trip" is prose.
_PART = re.compile(
    rf"(?:^[ \t>*-]*(?:\*\*)?part\s+\(?({_LABEL})\)?(?![a-z0-9])"
    rf"|\bpart\s+\(?({_LABEL})\)?(?=[ \t]*[:.)—]))",
    re.IGNORECASE | re.MULTILINE,
)
# "Find (a) the arc length and (b) the area" — lettered parts inside one
# sentence. A label here must open a phrase, and the text up to the next
# label must say something, so "(a) and (b)" or "(a) + (b)" never count.
_INLINE = re.compile(r"(?<=[\s$])\(([a-h])\)(?=\\?[ \t]*[A-Za-z\\])")
_FILLER = {"and", "or"}

# A numbered part must open with words; "(1) $2x + y = 5$" numbers an
# equation.
_WORDS_NEXT = re.compile(r"\**\$?[:.)]?[ \t]*[A-Za-z]{2}")

_SEQUENCES = ("abcdefgh", ("i", "ii", "iii", "iv"), "123456789")


def _labels(text: str, numbered: bool) -> set[str]:
    found: set[str] = set()
    for rx in (_PAREN, _BARE):
        for m in rx.finditer(text):
            label = m.group(1).lower()
            if label.isdigit() and not (numbered and _WORDS_NEXT.match(text, m.end())):
                continue
            found.add(label)
    found.update(m.group(1).lower() for m in _GLUED.finditer(text))
    for m in _PART.finditer(text):
        found.add((m.group(1) or m.group(2)).lower())
    inline = list(_INLINE.finditer(text))
    for prev, nxt in zip(inline, inline[1:]):
        if ord(nxt.group(1).lower()) - ord(prev.group(1).lower()) != 1:
            continue
        words = set(re.findall(r"[A-Za-z]+", text[prev.end():nxt.start()]))
        if {w.lower() for w in words} - _FILLER:
            found.update((prev.group(1).lower(), nxt.group(1).lower()))
    return found


def has_part_labels(text: str | None, *, numbered: bool = True) -> bool:
    """True when `text` is split into labeled sub-parts: two consecutive
    labels — (a)(b), (c)(d), (i)(ii), 1./2. — each where a part begins.

    `numbered=False` ignores plain numbered labels (1. / (1)), for a
    worked answer, whose numbered lines are its steps, not parts. "Part 1"
    still counts there."""
    if not text:
        return False
    labels = _labels(text, numbered)
    return any(
        seq[k] in labels and seq[k + 1] in labels
        for seq in _SEQUENCES for k in range(len(seq) - 1)
    )


def is_multi_part(question: str | None, final_answer: str | None) -> bool:
    """True when either the problem or its answer has labeled parts."""
    return has_part_labels(question) or has_part_labels(final_answer, numbered=False)
