"""ExtractionJob — one durable row per submission awaiting a Vision read.

Extraction was the last hop still held in one web server's memory. Submit
called `asyncio.create_task(_run_extraction_background(...))` and hoped,
and `_run_extraction_background` had exactly one caller — that spawn.
There was no queue, no sweeper, no admin re-run. So when the task died:

- the submission stayed durable but permanently unprocessable,
- the student's post-submit screen polled for 90s, showed "Couldn't
  prepare your check", and refreshing restarted a wait that could never
  finish,
- confirm_extraction answered 409 "extraction hasn't finished yet"
  forever, so integrity and grading never fired,
- and nothing anywhere said so: the database showed a submission with
  zero model calls and zero failures, which reads exactly like nothing
  was ever attempted.

That is not hypothetical. On 2026-09-03 the anthropic SDK floated from
0.116.0 to 1.3.0, which dropped the `temperature` kwarg. Every extraction
raised TypeError. Recovering ONE student's homework took a hand-written
script, production write credentials, and several hours of tracing —
because there was no record that the work was ever owed.

Grading already solved this exact problem (see GradingJob): write the
intent down first, work it second, and let a drain retry what failed.
This table applies that to the one hop that was missing it. The failure
above becomes a row with `status='failed'` and a `last_error`, retried on
the next drain once the underlying cause is fixed — with no script, no
credentials, and no one awake at 2am.

## Scheduling, and why it is simpler than grading's

`grading_jobs.scheduled_for` carries a real policy: a due date means the
class grades together and shares a cached prefix, and NULL means "wait
for a teacher". Extraction has no such choice — a submission's read is
owed the moment it arrives, and there is no batching benefit to waiting,
since each submission is its own set of photos. So there is no
`scheduled_for` here: queued means runnable now.

## One row per submission

`submission_id` is unique, which is what makes enqueueing idempotent. A
retried request, a double submit racing the one-shot guard, or an admin
re-run all collapse onto the same row instead of queueing the same Vision
call twice — and a Vision call is the most expensive thing this system
does per submission.

## `attempts` is a budget, not a counter

The drain gives up after MAX_ATTEMPTS so a submission whose photos will
never extract (corrupt upload, a page that is genuinely unreadable) stops
burning a Vision call on every drain forever. Exhausting the budget is
itself a signal: it means a human should look, which is what
`status='failed'` plus `last_error` exists to tell them.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_FAILED = "failed"
# Claimed, then found to owe nothing — the assignment's AI toggles were
# switched off after the job was queued. Distinct from `done` because
# `done` claims a read EXISTS, and an operator asking "did this
# submission get read?" would otherwise be told yes about a job that
# never made a call. Grading draws the same distinction for the same
# reason.
STATUS_SKIPPED = "skipped"

# Retries before the row is parked as `failed` for a human. Three covers
# the transient cases worth retrying — a timeout, a 529, a deploy landing
# mid-flight — without spending four Vision calls on a photo that is
# never going to read.
MAX_ATTEMPTS = 3


class ExtractionJob(Base):
    __tablename__ = "extraction_jobs"

    # Declared on the model, not only in the migration: an index the
    # model doesn't know about gets proposed for deletion by every
    # `alembic check`, which is how a real index disappears in an
    # unrelated autogenerate. Same reasoning as grading_jobs.
    __table_args__ = (
        Index("ix_extraction_jobs_status_created_at", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )

    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("submissions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # Denormalized from the submission so an operator can answer
    # "what is stuck for this assignment?" without a join, and so a
    # future drain can group by assignment if batching ever helps.
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assignments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # No index=True here: the drain's only hot query is the composite
    # (status, created_at) in __table_args__ above. A single-column index
    # as well would have autogenerate emit a redundant CREATE INDEX
    # forever.
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=STATUS_QUEUED,
    )

    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # The exception text from the last failed run. This is the field that
    # would have made the 2026-09-03 outage a one-query diagnosis instead
    # of a log-trace: "TypeError: ... unexpected keyword argument
    # 'temperature'" sitting on the row. No admin screen joins this
    # table yet — reading it is a SQL query for now — but the reason a
    # student's read never landed is written down instead of living only
    # in a log stream that has since rolled over.
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
