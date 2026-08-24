"""Client-side error reports.

The web app's `ErrorBoundary` used to log a crash to the console in
development and DISCARD it in production. On a deployed pilot that is the
worst possible failure mode: a teacher hits a bug, sees a polite retry
card, works around it, and forms an opinion about the product that never
reaches us. Unlike every other observability surface here, this data
cannot be recovered after the fact — a crash that wasn't captured when it
happened is gone.

One row per reported error. Written by `POST /v1/client-errors`, read by
the admin dashboard. Deliberately NOT `activity_log`: that table records
deliberate actor WRITES (`assignment.publish`, `grade.save`) and is read
for procurement audits, whereas this is unstructured failure telemetry
with a totally different shape, volume, and retention story.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base

# `kind` values — where the report came from, not how bad it is.
KIND_RENDER = "render"        # React ErrorBoundary caught a render throw
KIND_UNHANDLED = "unhandled"  # window.onerror
KIND_PROMISE = "promise"      # unhandledrejection
KIND_API = "api"              # a request failed (network, timeout, or 5xx)
VALID_KINDS = (KIND_RENDER, KIND_UNHANDLED, KIND_PROMISE, KIND_API)

# Column caps. A minified stack is a few KB; anything far past that is a
# runaway or a hostile payload, and the endpoint truncates rather than
# rejecting so we keep a usable report either way.
MAX_MESSAGE_CHARS = 2_000
MAX_STACK_CHARS = 16_000
MAX_ROUTE_CHARS = 512
MAX_USER_AGENT_CHARS = 512


class ClientError(Base):
    """One client-side error report.

    Append-only. Nothing mutates these rows — they are a record of what
    happened in someone's browser at a moment in time.
    """

    __tablename__ = "client_errors"
    __table_args__ = (
        # The dashboard's default read: newest first, optionally scoped
        # to one person (the pilot-teacher case).
        Index("ix_client_errors_created", "created_at"),
        Index("ix_client_errors_user_created", "user_id", "created_at"),
        # Grouping identical crashes into one row with a count.
        Index("ix_client_errors_fingerprint", "fingerprint"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )

    # Null when the crash happened before (or instead of) a successful
    # login — the login page can throw too, and those reports are exactly
    # the ones we'd otherwise never hear about. SET NULL on delete so the
    # record outlives the account it describes.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Snapshots taken at write time, so a report stays readable after the
    # user is deleted or changes role/school. Same denormalization
    # rationale as activity_log.school_id.
    user_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    school_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("schools.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    kind: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    stack: Mapped[str | None] = mapped_column(Text, nullable=True)
    # React's component stack. Render errors only; null elsewhere. Worth
    # its own column because it's what actually names the broken
    # component, which a minified JS stack usually doesn't.
    component_stack: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Client-computed hash of (message + first stack frames). Identical
    # crashes share one, so the dashboard shows "this broke 40 times"
    # rather than forty rows. Computed client-side because that's also
    # where it's needed for per-page-load dedupe.
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)

    # In-app path (`/school/teacher/courses/…`), not the full URL — query
    # strings can carry ids we don't need in a crash log.
    route: Mapped[str | None] = mapped_column(String(MAX_ROUTE_CHARS), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(
        String(MAX_USER_AGENT_CHARS), nullable=True,
    )
    # Whatever the reporting site knows that the columns above don't
    # cover — for `api` kind that's the request path and status code.
    # Free-form so a new reporting site doesn't need a migration.
    context: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
