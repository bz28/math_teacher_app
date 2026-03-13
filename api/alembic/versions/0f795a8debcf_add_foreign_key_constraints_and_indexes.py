"""add foreign key constraints and indexes

Revision ID: 0f795a8debcf
Revises: c3d4e5f6a7b8
Create Date: 2026-03-12 19:46:42.238838

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0f795a8debcf'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('llm_calls', 'created_at',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               nullable=False,
               existing_server_default=sa.text('now()'))
    op.create_index(op.f('ix_llm_calls_success'), 'llm_calls', ['success'], unique=False)
    op.create_foreign_key('fk_llm_calls_session_id', 'llm_calls', 'sessions', ['session_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key('fk_llm_calls_user_id', 'llm_calls', 'users', ['user_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key('fk_refresh_tokens_user_id', 'refresh_tokens', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    op.create_index(op.f('ix_sessions_status'), 'sessions', ['status'], unique=False)
    op.create_foreign_key('fk_sessions_user_id', 'sessions', 'users', ['user_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    op.drop_constraint('fk_sessions_user_id', 'sessions', type_='foreignkey')
    op.drop_index(op.f('ix_sessions_status'), table_name='sessions')
    op.drop_constraint('fk_refresh_tokens_user_id', 'refresh_tokens', type_='foreignkey')
    op.drop_constraint('fk_llm_calls_user_id', 'llm_calls', type_='foreignkey')
    op.drop_constraint('fk_llm_calls_session_id', 'llm_calls', type_='foreignkey')
    op.drop_index(op.f('ix_llm_calls_success'), table_name='llm_calls')
    op.alter_column('llm_calls', 'created_at',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               nullable=True,
               existing_server_default=sa.text('now()'))
