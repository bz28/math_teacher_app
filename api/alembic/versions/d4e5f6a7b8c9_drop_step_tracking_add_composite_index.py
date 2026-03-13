"""drop step_tracking column, add composite index on sessions(user_id, created_at)

Revision ID: d4e5f6a7b8c9
Revises: 0f795a8debcf
Create Date: 2026-03-12 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = '0f795a8debcf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('sessions', 'step_tracking')
    op.create_index(
        'ix_sessions_user_id_created_at',
        'sessions',
        ['user_id', 'created_at'],
    )


def downgrade() -> None:
    op.drop_index('ix_sessions_user_id_created_at', table_name='sessions')
    op.add_column(
        'sessions',
        sa.Column('step_tracking', postgresql.JSON(), nullable=False, server_default='{}'),
    )
