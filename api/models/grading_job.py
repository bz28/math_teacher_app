"""GradingJob — one durable row per submission awaiting AI grading.

Grading used to be a promise held in one web server's memory: the confirm
endpoint called `asyncio.create_task(...)` and hoped. That promise had a
lifetime of about a minute, so a deploy landing inside the window was
unlikely and the work almost always ran. Three things were still true:

- a restart mid-flight lost the work with no record it was ever owed,
- a transient LLM error was permanent (the handler logged "teacher can
  grade manually" and rolled back — no retry, no trace),
- and nothing could answer "what is pending?" or "what failed last
  night?", because the only place that state lived was a local variable.

Deferring grading to an assignment's due date turns that promise from a
one-minute wait into a multi-day one, which in-memory cannot survive. So
the intent gets written down first and worked second.

The row is also what makes BATCHING possible at all: grouping a class
into one run requires a list of what is pending, and this table is that
list. Without it there is nothing to group.

## Scheduling

`scheduled_for` carries the whole policy and has three meanings:

- **a timestamp in the future** — an assignment with a due date. The
  drain picks it up once that time passes, and the class grades together.
- **a timestamp now//past** — a teacher pressed "Grade all" or "Grade
  now", or a late submission arrived after the due date. Runs on the next
  drain.
- **NULL** — no due date on the assignment, so there is no moment that
  means "the class is in". These wait for a teacher to ask, and are the
  reason a drain must never treat NULL as "run immediately". Ungraded
  work still surfaces to the teacher through the existing to-review
  count, so it cannot go quietly missing.

## One row per submission

`submission_id` is unique. A regrade resets the existing row rather than
appending, so the table stays the queue rather than becoming a log —
`attempts` and `last_error` carry the history that matters for
debugging. Per-run history lives in `llm_calls`, which already records
every grading call with its cost.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base

# queued  — owed, waiting for `scheduled_for` (or for a teacher, if NULL).
# running — claimed by a drain worker; `started_at` is when.
# done    — graded. Terminal until a regrade resets the row.
# skipped — closed with no grade, and none coming: no extraction, AI
#           grading switched off after submit, or an unreadable photo.
#           Terminal. Deliberately NOT `done` — `done` asserts a grade
#           exists, so folding these in would make "is this class
#           graded?" answer yes when it isn't.
# failed  — exhausted `MAX_ATTEMPTS`; `last_error` says why. Terminal
#           until a teacher retries, so a stuck job is visible rather
#           than silently retrying forever.
STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_SKIPPED = "skipped"
STATUS_FAILED = "failed"

# A job is retried this many times before it parks in `failed`. Grading
# failures are nearly always transient (a 529, a timeout); a genuinely
# ungradeable submission fails the same way every time, and parking it
# is how the teacher finds out instead of it cycling forever.
MAX_ATTEMPTS = 3

# A `running` job older than this is presumed abandoned — its worker was
# deployed over or crashed — and is reclaimed by the next drain. Grading
# a class takes seconds to low minutes, so 15 is comfortably clear of a
# slow-but-alive run while still recovering quickly after a restart.
STALE_RUNNING_MINUTES = 15


class GradingJob(Base):
    __tablename__ = "grading_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )

    # One job per submission. The unique constraint is what makes
    # enqueueing idempotent: a double-confirm, a retried request, or a
    # concurrent regrade all collapse onto the same row instead of
    # queueing the same work twice.
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("submissions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # Denormalized from the submission so the drain can group a class
    # into one run without joining, and so the admin console can answer
    # "what is pending for this assignment?" with one indexed query.
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assignments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # No index=True here or on scheduled_for: the migration creates a
    # composite (status, scheduled_for), which is the drain's only hot
    # query. Declaring singles as well makes `alembic revision
    # --autogenerate` emit two CREATE INDEXes forever.
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=STATUS_QUEUED,
    )

    # NULL means "no due date — wait for a teacher". See the module
    # docstring: the drain must never read NULL as "run now".
    scheduled_for: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Who caused the most recent run. NULL for the scheduled path (nobody
    # pressed anything); set to the teacher for "Grade all"/"Grade now"
    # so LLM cost stays attributable the way the regrade path already
    # does it.
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
