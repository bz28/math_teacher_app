"""add llm_calls table

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'llm_calls',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('session_id', UUID(as_uuid=True), nullable=True, index=True),
        sa.Column('user_id', UUID(as_uuid=True), nullable=True, index=True),
        sa.Column('function', sa.String(50), nullable=False, index=True),
        sa.Column('model', sa.String(100), nullable=False),
        sa.Column('input_tokens', sa.Integer, nullable=False),
        sa.Column('output_tokens', sa.Integer, nullable=False),
        sa.Column('latency_ms', sa.Float, nullable=False),
        sa.Column('cost_usd', sa.Float, nullable=False),
        sa.Column('success', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('retry_count', sa.Integer, nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
    )


def downgrade() -> None:
    op.drop_table('llm_calls')
