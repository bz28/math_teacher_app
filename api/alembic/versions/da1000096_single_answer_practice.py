"""single-answer practice: no wrong options on multi-part practice items

Revision ID: da1000096
Revises: cv1000091
Create Date: 2026-10-29 00:00:00.000000

A multi-part practice problem ("(a) find x, (b) name the postulate")
turned into a give-away multiple-choice question: its wrong options
answer one part, the right one answers every part. Generation now skips
wrong options for those (api/core/part_labels.py). This clears the ones
already stored on approved practice items whose final answer has parts,
so they are practiced as free response. Prod, 2026-10-29: 3 items, all
in one published practice set (ids in the PR body).

It also turns literal backslash-n pairs outside math in stored final
answers into real line breaks, the same fix generation now applies when
it stores an answer (`real_newlines`). Prod: 4 items.

Both classifiers are frozen copies, so this revision means the same thing
however the live code changes later. Nothing is deleted: the question,
answer, and steps are untouched, and a teacher can still type wrong
options back in.
"""

from __future__ import annotations

import json
import re

import sqlalchemy as sa
from alembic import op

revision: str = "da1000096"
down_revision: str | None = "cv1000091"
branch_labels = None
depends_on = None

# Frozen from api/core/part_labels.py.
_LABEL = r"[a-h]|iv|i{1,3}"
_PAREN = re.compile(rf"(?:^|(?<=[\s*$>]))\(\s*({_LABEL})\s*\)(?=[\s*$:.,\\]|$)", re.IGNORECASE)
_LINE = re.compile(rf"^[ \t>*-]*({_LABEL})[).](?:\*\*)?[ \t]", re.IGNORECASE | re.MULTILINE)
_PART = re.compile(rf"\bpart\s+\(?({_LABEL}|[1-9])\)?(?=[\s:.,)*]|$)", re.IGNORECASE)
_PAIRS = ({"a", "b"}, {"i", "ii"}, {"1", "2"})


def has_part_labels(text: str | None) -> bool:
    if not text:
        return False
    labels = {m.lower() for rx in (_PAREN, _LINE, _PART) for m in rx.findall(text)}
    return any(pair <= labels for pair in _PAIRS)


# Frozen from api/core/question_bank_generation.py.
_MATH = re.compile(r"(\$\$.*?\$\$|(?<!\\)\$.*?(?<!\\)\$|\\\(.*?\\\)|\\\[.*?\\\])", re.DOTALL)
_LITERAL_NEWLINE = re.compile(
    r"(?<!\\)\\n(?!(?:e|eq|eg|abla|u|ot|i|mid|ewline|oindent|leq|geq|cong|sim|parallel|exists)\b)"
)


def real_newlines(text: str) -> str:
    if "\\n" not in text:
        return text
    return "".join(
        part if i % 2 else _LITERAL_NEWLINE.sub("\n", part)
        for i, part in enumerate(_MATH.split(text))
    )


def _has_options(raw: object) -> bool:
    # JSON null and SQL NULL both arrive as None; a non-empty list is the
    # only shape that renders as multiple choice.
    if isinstance(raw, str):
        raw = json.loads(raw)
    return isinstance(raw, list) and len(raw) > 0


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT q.id, q.final_answer, q.distractors FROM question_bank_items q "
        "JOIN assignments a ON a.id = q.originating_assignment_id "
        "WHERE a.type = 'practice' AND q.status = 'approved'"
    )).all()
    for row in rows:
        if has_part_labels(row.final_answer) and _has_options(row.distractors):
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
