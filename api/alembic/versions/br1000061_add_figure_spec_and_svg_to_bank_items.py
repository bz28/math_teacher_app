"""add figure_spec + figure_svg to question_bank_items.

Adds optional figure storage to bank items so the AI generator can
attach a geometry diagram to any question that benefits from one.

`figure_spec` holds the structured JSON DSL (see api/core/geometry/
dsl.py) the LLM emits; `figure_svg` holds the deterministically
rendered SVG string the frontend displays. Both nullable — only
geometry-style questions populate them.

We store both columns (not just the spec) for two reasons:
1. The rendering step happens at generation time. Re-rendering on
   every read would burn CPU and risk drift if the renderer evolves.
2. The spec is the canonical truth (teachers will eventually edit
   it via a visual editor); the SVG is the cached display artifact.

Revision ID: br1000061
Revises: bq1000060
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "br1000061"
down_revision: str | None = "bq1000060"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "question_bank_items",
        sa.Column("figure_spec", JSONB(), nullable=True),
    )
    op.add_column(
        "question_bank_items",
        sa.Column("figure_svg", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("question_bank_items", "figure_svg")
    op.drop_column("question_bank_items", "figure_spec")
