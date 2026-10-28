"""A grading rule the app offered to add to a class's rubric.

When a teacher lowers an AI grade and says why, the reason is often a
standard they hold for the whole class ("answers need units"). The app
offers to add it as a class rule. Each offer is a row here, so the answer
is remembered: a declined rule is never offered again in that class, and
an offer the teacher ignored can come back on a later edit. Shape and flow:
api/core/rubric_suggestions.py.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base

# pending: offered, not answered (ignoring an offer leaves it here).
# added: added to the class rubric. added_homework: added to that
# homework's extra rules only. declined: "No thanks" — never re-offered.
SUGGESTION_STATUSES = ("pending", "added", "added_homework", "declined")


class RubricSuggestion(Base):
    __tablename__ = "rubric_suggestions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    # Where it came from — the homework, submission and problem whose
    # grade the teacher lowered. Kept loose so deleting work keeps the
    # class's memory of what it declined.
    assignment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True,
    )
    submission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("submissions.id", ondelete="SET NULL"), nullable=True,
    )
    problem_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    teacher_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The homework's title at the time ("HW 5"), shown as the rule's origin.
    source_label: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # The teacher's own words that prompted it.
    teacher_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
