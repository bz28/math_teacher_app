"""swap submissions.image_data for submissions.files (multi-file)

Revision ID: bg1000050
Revises: bf1000049
Create Date: 2026-04-29 00:00:00.000000

Replaces the single base64 `image_data` column with a JSON `files` list
storing `[{data, media_type, filename?}]` so a student can turn in
multiple pages (photos and/or PDFs) per submission. Server-side
validation goes through api.core.image_utils.validate_and_decode_upload.

Pre-launch: no real users, no backfill.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bg1000050"
down_revision: str | None = "bf1000049"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("submissions", "image_data")
    op.add_column(
        "submissions",
        sa.Column("files", postgresql.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("submissions", "files")
    op.add_column(
        "submissions",
        sa.Column("image_data", sa.Text(), nullable=True),
    )
