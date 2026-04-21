"""Section enrollment — links students to sections."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class SectionEnrollment(Base):
    __tablename__ = "section_enrollments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    section_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sections.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    # Denormalized mirror of `sections.course_id`. Enforces one
    # enrollment per (student, course) at the DB level — Postgres
    # can't reference another table from a unique index, and a
    # section's course doesn't change, so the mirror stays in sync
    # trivially. Writers must set this alongside section_id.
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("section_id", "student_id", name="uq_section_student"),
        UniqueConstraint("student_id", "course_id", name="uq_section_enrollments_student_course"),
    )
