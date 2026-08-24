"""GoldenCase — one row per curated eval golden case.

The "golden set" is the regression corpus the autonomous harness replays: a
curated set of generation scenarios that must keep passing. Each case carries
its own definition (the natural-language steer + what shape it should produce)
PLUS the outcome of the most recent eval that ran it, so the admin dashboard
can show, at a glance, which cases still pass and catch a regression the moment
one flips from pass to fail.

The harness runs against a separate DB but upserts these rows into the MAIN app
DB (the one the dashboard reads) after each corpus run — the same cross-DB
summary path `HarnessRun` uses. `last_run_id` points at that run's `HarnessRun`
so the dashboard can open its full HTML failure report in-app.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base

# The three eval verdicts a case can be in. `pending` = added/queued but not yet
# evaluated by a corpus run.
STATUS_PASS = "pass"
STATUS_FAIL = "fail"
STATUS_PENDING = "pending"


class GoldenCase(Base):
    __tablename__ = "golden_cases"

    # A case is identified by (probe, name); the corpus loader relies on
    # that being unique.
    __table_args__ = (
        UniqueConstraint("probe", "name", name="uq_golden_cases_probe_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    # The probe/feature this case exercises — the dashboard's "course" column
    # (e.g. "geometry"). Together with `name` it's the natural key the harness
    # upserts on.
    probe: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # The natural-language steer handed to real generation — the "problem".
    constraint: Mapped[str] = mapped_column(Text, nullable=False)
    # True for a deliberately hostile case (extreme scales, near-degenerate
    # slivers, inconsistent specs); drives the "adversarial / coverage" tag.
    adversarial: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Shapes the case expects generation to produce (geometry probe today).
    expected_shapes: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Last-eval outcome (upserted by the harness after each corpus run) ──
    # pass | fail | pending
    last_status: Mapped[str] = mapped_column(
        String(12), nullable=False, default=STATUS_PENDING,
    )
    # The status *before* the most recent eval — lets the dashboard flag a
    # regression (prev pass → now fail) without a second query.
    prev_status: Mapped[str | None] = mapped_column(String(12), nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    last_model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # The HarnessRun that last evaluated this case — the dashboard opens its
    # full HTML report from `/harness-runs/{id}/report`. Loose reference (no FK)
    # so pruning old runs never blocks on golden-case rows.
    last_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )
    # The model's actual last-run output for this case — a pass note or the
    # concrete failure reason. Shown verbatim in the drill-in.
    last_output: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Operator asked for a fresh eval; the next corpus run clears it.
    rerun_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    # Retired from the active set (kept for history, excluded from the tiles).
    retired: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
