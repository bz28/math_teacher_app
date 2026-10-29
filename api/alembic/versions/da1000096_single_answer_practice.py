"""single-answer practice: no wrong options on multi-part practice items

Revision ID: da1000096
Revises: cw1000092
Create Date: 2026-10-29 00:00:00.000000

A multi-part practice problem ("(a) find x, (b) name the postulate")
turned into a give-away multiple-choice question: its wrong options
answer one part, the right one answers every part. Generation now skips
wrong options for those (api/core/part_labels.py). This clears the ones
already stored on approved practice items whose question or final
answer has parts, so they are practiced as free response. Prod, 2026-10-29: 3 items, all
in one published practice set (ids in the PR body).

It also turns literal backslash-n pairs outside math in stored final
answers into real line breaks, the same fix generation now applies when
it stores an answer (`real_newlines`). Prod: 4 items.

Both classifiers are frozen copies, so this revision means the same thing
however the live code changes later. Nothing is deleted: questions and
steps are untouched, an answer changes only by those line breaks, and a
teacher can still type wrong options back in.
"""

from __future__ import annotations

import json
import re

import sqlalchemy as sa
from alembic import op

revision: str = "da1000096"
down_revision: str | None = "cw1000092"
branch_labels = None
depends_on = None

# Frozen from api/core/part_labels.py.
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


# Frozen from api/core/question_bank_generation.py.
_MATH = re.compile(r"(\$\$.*?\$\$|(?<!\\)\$.*?(?<!\\)\$|\\\(.*?\\\)|\\\[.*?\\\])", re.DOTALL)
_LITERAL_NEWLINE = re.compile(r"(?<!\\)(?:(?:\\n){2,}|\\n(?![A-Za-z]))")


def real_newlines(text: str) -> str:
    """Turn literal backslash-n pairs outside math into line breaks."""
    if "\\n" not in text:
        return text
    return "".join(
        part if i % 2 else _LITERAL_NEWLINE.sub(lambda m: "\n" * (len(m.group()) // 2), part)
        for i, part in enumerate(_MATH.split(text))
    )


def is_multi_part(question: str | None, final_answer: str | None) -> bool:
    # The answer is read with its literal backslash-n pairs as the line
    # breaks they render as (fixed below), or a "(b)" after one would not
    # be seen as opening a line — prod item 354df559 is exactly that.
    answer = real_newlines(final_answer) if final_answer else final_answer
    return has_part_labels(question) or has_part_labels(answer, numbered=False)


def _has_options(raw: object) -> bool:
    # JSON null and SQL NULL both arrive as None; a non-empty list is the
    # only shape that renders as multiple choice.
    if isinstance(raw, str):
        raw = json.loads(raw)
    return isinstance(raw, list) and len(raw) > 0


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT q.id, q.question, q.final_answer, q.distractors FROM question_bank_items q "
        "JOIN assignments a ON a.id = q.originating_assignment_id "
        "WHERE a.type = 'practice' AND q.status = 'approved'"
    )).all()
    for row in rows:
        if is_multi_part(row.question, row.final_answer) and _has_options(row.distractors):
            conn.execute(
                sa.text("UPDATE question_bank_items SET distractors = NULL WHERE id = :id"),
                {"id": row.id},
            )

    rows = conn.execute(sa.text(
        "SELECT id, final_answer FROM question_bank_items WHERE strpos(final_answer, :bn) > 0"
    ), {"bn": "\\n"}).all()
    for row in rows:
        fixed = real_newlines(row.final_answer)
        if fixed != row.final_answer:
            conn.execute(
                sa.text("UPDATE question_bank_items SET final_answer = :a WHERE id = :id"),
                {"a": fixed, "id": row.id},
            )


def downgrade() -> None:
    # The cleared options were give-aways and the literal "\n" pairs were
    # rendering bugs; neither is worth restoring.
    pass
