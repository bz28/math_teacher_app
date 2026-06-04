"""HarnessRun — one row per autonomous test-harness run (tests/harness).

A run-level summary the admin dashboard surfaces in its own "Harness Runs"
tab. The harness executes against a separate database, but writes this
summary into the MAIN app DB so the dashboard (which reads the main DB)
can show run history, scores, and cost without a cross-DB connection. The
deep per-run detail lives in the harness's HTML report (report_path).
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class HarnessRun(Base):
    __tablename__ = "harness_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    probe: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # replay | record | auto
    mode: Mapped[str] = mapped_column(String(20), nullable=False)

    items_generated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    det_pass: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    det_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    captures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    judge_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    judge_mean: Mapped[float | None] = mapped_column(Float, nullable=True)

    # null on replay ($0) or when cost couldn't be read.
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_path: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True,
    )
