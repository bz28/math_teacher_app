"""Practice/Learn activity log — persists what each school student
practiced or learned.

Today the practice/learn runner computes per-problem outcomes and then
discards them. This table keeps one row per problem per finished session
so (a) the student can see their own practice history and (b) the teacher
gets engagement + struggle INSIGHTS.

It is explicitly NOT a grade store: practice stays ungraded by design.
There are no scores, no raw student answers, and no correctness beyond
the coarse `outcome` signal (did the student get it first try, did they
retry, did they reveal the solution, did they finish a Learn walkthrough).
BankConsumption records served/completed/flagged but carries no outcome,
which is why this is a separate table.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base

# `mode` values.
MODE_PRACTICE = "practice"
MODE_LEARN = "learn"
VALID_MODES = (MODE_PRACTICE, MODE_LEARN)

# `outcome` values for mode="practice".
OUTCOME_FIRST_TRY = "first_try"
OUTCOME_RETRY = "retry"
OUTCOME_REVEALED = "revealed"
PRACTICE_OUTCOMES = (OUTCOME_FIRST_TRY, OUTCOME_RETRY, OUTCOME_REVEALED)

# `outcome` value for mode="learn".
OUTCOME_COMPLETED = "completed"

# The two practice outcomes that signal the student struggled — used by
# both teacher reads to surface what to re-teach.
STRUGGLE_OUTCOMES = (OUTCOME_RETRY, OUTCOME_REVEALED)


class PracticeActivity(Base):
    """One row per problem practiced/learned in a finished session.

    Append-only: the runner posts a session's rows once the student
    leaves the loop. Rows are never mutated — they're an immutable
    activity log, not live state.
    """

    __tablename__ = "practice_activity"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        # Teacher reads scope by section and order by recency.
        Index("ix_practice_activity_section_created", "section_id", "created_at"),
        # Student read + per-student teacher read scope by student/set.
        Index("ix_practice_activity_student_assignment", "student_id", "practice_assignment_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    # The section the student was enrolled in when they practiced —
    # derived from enrollment at record time so teacher scoping is a
    # single index hit and survives later re-enrollment.
    section_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sections.id", ondelete="CASCADE"), nullable=False,
    )
    practice_assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False,
    )
    bank_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("question_bank_items.id", ondelete="CASCADE"), nullable=False,
    )
    # "practice" | "learn". See VALID_MODES.
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    # practice → "first_try" | "retry" | "revealed"; learn → "completed".
    # Nullable so a future mode can record an activity with no outcome.
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # How many tutor-chat messages the student sent on this problem — a
    # cheap engagement signal layered on top of the outcome.
    tutor_message_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
