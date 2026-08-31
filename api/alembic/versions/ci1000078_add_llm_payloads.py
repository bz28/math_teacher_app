"""Record what every LLM call actually sent, content-addressed.

Revision ID: ci1000078
Revises: ch1000077
Create Date: 2026-08-31

`llm_calls.input_text` has only ever held the user message. Every call
also sends a system prompt — the grading rubric and answer key, the
tutoring guardrails, the generation spec — which was never stored.
Measured across a real call log the stored half is **0.7%-15% of the
tokens actually sent**, ~4% typically. So an operator looking at a bad
grade could see the wrong answer but not the instructions that produced
it, which is the only part you can act on.

There is a second unrecorded half: the **tool schema**, sent as `tools=`
and forced with `tool_choice`. On a measured grading call that was 656 of
962 input tokens — larger than the system prompt — and it defines the
shape of the answer (the deduction ledger, the score fields).

`llm_payloads` holds each distinct payload once, keyed by SHA-256, with a
`kind` of "system_prompt" or "tool_schema". `llm_calls` points at both.
Content-addressing is what makes this affordable: a system prompt is
built to be byte-identical across a class (that IS the caching contract),
and a tool schema is static per call site, so a term of grading costs
about one row per rubric rather than one per call.

**On the backfill rule.** CLAUDE.md requires a column that existing rows
need to ship with a backfill in the same migration. This column
deliberately ships NULL for all history, because there is nothing to
backfill with: the text was never captured, and no amount of
reconstruction would tell you what a specific historical call actually
sent. A NULL that every reading surface renders as "not recorded" is
honest; a plausible-looking reconstruction attached to a real call is
the exact failure this whole change exists to fix.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ci1000078"
down_revision: str | None = "ch1000077"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "llm_payloads",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        # Unique, because the insert path is ON CONFLICT DO NOTHING:
        # persistence runs as fire-and-forget background tasks, so two
        # calls sharing a prompt race on its first use and must converge
        # on one row rather than duplicating it.
        # NOT `unique=True` — the unique INDEX below is the constraint.
        # Declaring both makes Postgres build two unique b-trees on one
        # column, doubling write cost and disk on the table this change
        # argues into existence on cost grounds, and leaves the model
        # (which renders only the index) permanently out of sync so every
        # future autogenerate emits a spurious drop_constraint.
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("char_len", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("function", sa.String(50), nullable=False),
        sa.Column(
            "first_seen_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )
    op.create_index(
        "ix_llm_payloads_sha256", "llm_payloads", ["sha256"], unique=True,
    )
    op.create_index("ix_llm_payloads_function", "llm_payloads", ["function"])
    op.create_index("ix_llm_payloads_kind", "llm_payloads", ["kind"])

    for col in ("system_prompt_id", "tool_schema_id"):
        op.add_column(
            "llm_calls",
            sa.Column(col, postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            f"fk_llm_calls_{col}", "llm_calls", "llm_payloads",
            [col], ["id"], ondelete="SET NULL",
        )
        op.create_index(f"ix_llm_calls_{col}", "llm_calls", [col])


def downgrade() -> None:
    for col in ("tool_schema_id", "system_prompt_id"):
        op.drop_index(f"ix_llm_calls_{col}", table_name="llm_calls")
        op.drop_constraint(f"fk_llm_calls_{col}", "llm_calls", type_="foreignkey")
        op.drop_column("llm_calls", col)
    op.drop_index("ix_llm_payloads_kind", table_name="llm_payloads")
    op.drop_index("ix_llm_payloads_function", table_name="llm_payloads")
    op.drop_index("ix_llm_payloads_sha256", table_name="llm_payloads")
    op.drop_table("llm_payloads")
