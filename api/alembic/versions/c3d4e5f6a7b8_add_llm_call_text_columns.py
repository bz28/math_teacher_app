"""add input_text and output_text to llm_calls

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-08 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('llm_calls', sa.Column('input_text', sa.Text(), nullable=True))
    op.add_column('llm_calls', sa.Column('output_text', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('llm_calls', 'output_text')
    op.drop_column('llm_calls', 'input_text')
