"""add work_submissions table

Revision ID: e5f6a7b8c9d0
Revises: 85c95bea1f52
Create Date: 2026-03-24 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = '85c95bea1f52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('work_submissions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('session_id', sa.UUID(), nullable=True),
    sa.Column('problem_index', sa.Integer(), nullable=False),
    sa.Column('diagnosis', sa.JSON(), nullable=False),
    sa.Column('summary', sa.String(length=500), nullable=False),
    sa.Column('has_issues', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_work_submissions_user_id'), 'work_submissions', ['user_id'], unique=False)
    op.create_index('ix_work_submissions_user_created', 'work_submissions', ['user_id', 'created_at'], unique=False)
    op.create_index('ix_work_submissions_session_problem', 'work_submissions', ['session_id', 'problem_index'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_work_submissions_session_problem', table_name='work_submissions')
    op.drop_index('ix_work_submissions_user_created', table_name='work_submissions')
    op.drop_index(op.f('ix_work_submissions_user_id'), table_name='work_submissions')
    op.drop_table('work_submissions')
