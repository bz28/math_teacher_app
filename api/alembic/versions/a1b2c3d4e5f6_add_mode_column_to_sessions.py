"""add mode column to sessions

Revision ID: a1b2c3d4e5f6
Revises: 556f267e43c7
Create Date: 2026-03-04 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '556f267e43c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sessions', sa.Column('mode', sa.String(length=20), nullable=False, server_default='learn'))


def downgrade() -> None:
    op.drop_column('sessions', 'mode')
