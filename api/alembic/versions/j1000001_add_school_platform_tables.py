"""add school platform tables: courses, sections, section_enrollments, documents

Revision ID: j1000001
Revises: i9d0e1f2g3h4
Create Date: 2026-03-31 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = 'j1000001'
down_revision: Union[str, None] = 'i9d0e1f2g3h4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'courses',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('teacher_id', UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('subject', sa.String(30), nullable=False, server_default='math'),
        sa.Column('grade_level', sa.Integer(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='draft'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_courses_teacher_id', 'courses', ['teacher_id'])

    op.create_table(
        'sections',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('course_id', UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('join_code', sa.String(10), unique=True, nullable=True),
        sa.Column('join_code_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_sections_course_id', 'sections', ['course_id'])

    op.create_table(
        'section_enrollments',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('section_id', UUID(as_uuid=True), nullable=False),
        sa.Column('student_id', UUID(as_uuid=True), nullable=False),
        sa.Column('enrolled_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['section_id'], ['sections.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('section_id', 'student_id', name='uq_section_student'),
    )
    op.create_index('ix_section_enrollments_section_id', 'section_enrollments', ['section_id'])
    op.create_index('ix_section_enrollments_student_id', 'section_enrollments', ['student_id'])

    op.create_table(
        'documents',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('course_id', UUID(as_uuid=True), nullable=False),
        sa.Column('teacher_id', UUID(as_uuid=True), nullable=False),
        sa.Column('filename', sa.String(500), nullable=False),
        sa.Column('file_type', sa.String(50), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('image_data', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_documents_course_id', 'documents', ['course_id'])


def downgrade() -> None:
    op.drop_table('documents')
    op.drop_table('section_enrollments')
    op.drop_table('sections')
    op.drop_table('courses')
