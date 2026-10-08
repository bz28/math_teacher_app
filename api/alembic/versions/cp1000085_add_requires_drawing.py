"""add question_bank_items.requires_drawing (+ teacher_set, undo); repair leaked visual_work

Revision ID: cp1000085
Revises: cn1000083
Create Date: 2026-09-29 00:00:00.000000

Drawings only matter where a question asks for one. `requires_drawing`
is that fact, per question; it gates where recorded drawings are USED
(verify pass, grader, review page) — never what is recorded, so nothing
here deletes drawing data.

1. Columns: `requires_drawing` (bool, NOT NULL, default false),
   `requires_drawing_teacher_set` (bool, NOT NULL, default false — no
   teacher has set any flag yet), `previous_requires_drawing` (nullable,
   the one-level undo slot).
2. Backfill `requires_drawing` for every existing item from the question
   text, with the classifier FROZEN below (a copy of
   api/core/drawing_requirement.py at this revision), so a fresh database
   backfills identically however that module evolves.
3. Repair, non-destructively, every `visual_work` entry whose description
   is the internal sentence the old verify pass wrote over it (with a
   false verified=true): verified -> false, description -> "" (the
   original was overwritten and can't be recovered), and unconfirmed ->
   true unless the entry is a table (the zoomed check can't read tables,
   so a table is never "unconfirmed" — only unverified). On any problem.
   Nothing is deleted. Idempotent: a repaired entry no longer carries
   the sentence.

`submissions.extraction` is a `json` column: rows are matched with a text
cast and rewritten from Python. Downgrade drops the columns and leaves
the (repaired) extraction data alone — restoring the sentence would
restore the bug.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "cp1000085"
down_revision: str | None = "cn1000083"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LEAKED = (
    "A zoomed second look at the reported location found no drawing; "
    "the first-pass description could not be confirmed."
)

# ── frozen classifier (api/core/drawing_requirement.py @ cp1000085) ──
_VERB = re.compile(r"\b(graph|sketch|plot|draw|shade|construct)\b", re.IGNORECASE)
_NOUN_BEFORE = {
    "the", "a", "an", "this", "that", "these", "those", "its", "their", "his", "her",
    "given", "following", "bar", "line", "scatter", "dot", "box", "circle", "whose",
    "which",  # a multiple-choice "which graph shows …"
}
_NOT_A_REQUEST_AFTER = re.compile(
    r"\s*(?:"
    r"shown|below|above|provided|given|paper|twist|point"
    # probability / games: "draw a card", "draw two marbles"
    r"|(?:a|an|the|one|two|three|four|five|\d+)?\s*(?:red\s+|blue\s+|green\s+)?"
    r"(?:cards?|marbles?|balls?|chips?|tiles?|names?|socks?|tickets?|straws?)\b"
    r"|of\b"
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
        return not _IS_PROOF.search(text)
    return True


def requires_drawing(question: str | None) -> bool:
    if not question:
        return False
    text = _OPTIONAL.sub(" ", _NEGATED.sub(" ", " ".join(question.split())))
    if any(p.search(text) for p in _ALWAYS):
        return True
    return any(_verb_is_a_request(text, m) for m in _VERB.finditer(text))


# ── visual_work repair ──

def repair_visual_work(visual_work: list[Any]) -> list[Any]:
    """Pure per-entry repair (see the module docstring). Deletes nothing.
    Exposed for tests and the prod dry run."""
    out: list[Any] = []
    for v in visual_work:
        if isinstance(v, dict) and v.get("description") == LEAKED:
            v = {**v, "verified": False, "description": ""}
            if v.get("kind") != "table":
                v["unconfirmed"] = True
        out.append(v)
    return out


def upgrade() -> None:
    op.add_column(
        "question_bank_items",
        sa.Column("requires_drawing", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "question_bank_items",
        sa.Column("requires_drawing_teacher_set", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
    )
    op.add_column(
        "question_bank_items",
        sa.Column("previous_requires_drawing", sa.Boolean(), nullable=True),
    )
    conn = op.get_bind()

    items = conn.execute(sa.text("SELECT id, question FROM question_bank_items")).fetchall()
    flagged = [row_id for row_id, question in items if requires_drawing(question)]
    if flagged:
        conn.execute(
            sa.text("UPDATE question_bank_items SET requires_drawing = true WHERE id = ANY(:ids)"),
            {"ids": flagged},
        )

    rows = conn.execute(sa.text(
        "SELECT id, extraction FROM submissions "
        "WHERE extraction IS NOT NULL AND extraction::text LIKE :needle"
    ), {"needle": "%A zoomed second look at the reported location found no drawing%"}).fetchall()
    for sub_id, extraction in rows:
        data = extraction if isinstance(extraction, dict) else json.loads(extraction)
        vw = data.get("visual_work")
        if not isinstance(vw, list):
            continue
        repaired = repair_visual_work(vw)
        if repaired == vw:
            continue
        data["visual_work"] = repaired
        conn.execute(
            sa.text("UPDATE submissions SET extraction = CAST(:ext AS json) WHERE id = :id"),
            {"ext": json.dumps(data), "id": sub_id},
        )


def downgrade() -> None:
    op.drop_column("question_bank_items", "previous_requires_drawing")
    op.drop_column("question_bank_items", "requires_drawing_teacher_set")
    op.drop_column("question_bank_items", "requires_drawing")
