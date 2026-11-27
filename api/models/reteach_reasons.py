"""ReteachReasons — why a period lost points on a homework's flagged problems.

Student Insights flags a problem when at least half the class didn't get
full credit on it (`api.core.insights_counting`). The teacher's next
question is *why*, and her own approved feedback already says: each lost
point carries a note and an itemized deduction. `api.core.reteach_reasons`
groups those notes into the few most common reasons with one cheap model
call per flagged problem, and stores the answer here so a page view never
calls a model.

One row per homework × section. `problems` maps a flagged problem's
bank-item id to what was written for it:

    {"input_key":  sha256 of exactly what the model was given,
     "n_items":    how many students' feedback that was,
     "reasons":    [{"label": str, "submission_ids": [str, ...]}] | None,
     "attempts":   failed calls on this input_key,
     "prompt_version": "reteach_reasons@v1"}

`reasons` is None until a call succeeds; a failing input is tracked as
`failed_key` / `attempts` beside the last good read. `grades_signature`
is the counted-grade state the row last caught up with: the drain only
revisits a pair once that state moves.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class ReteachReasons(Base):
    __tablename__ = "reteach_reasons"
    __table_args__ = (UniqueConstraint("assignment_id", "section_id", name="uq_reteach_reasons_pair"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False,
    )
    section_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sections.id", ondelete="CASCADE"), nullable=False,
    )
    grades_signature: Mapped[str | None] = mapped_column(Text, nullable=True)
    problems: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now(),
    )
