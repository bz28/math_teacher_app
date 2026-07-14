"""Role-agnostic activity log.

One row per notable actor action — admin writes (delete, role change,
export) AND teacher writes (assignment create/publish, generation
start, bank approve/reject, grade save/review/publish). Written by
`api.core.audit_log.record_activity`. Queried by ops/leadership for
procurement audits and by the founder observability hub to watch what
a pilot teacher actually does and generates.

Superset of the old admin-only audit log: `actor_user_id`/`actor_role`
replace the admin-specific columns, and `school_id` is denormalized at
write time so the dashboard can filter a whole school's activity
without a join.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class ActivityLog(Base):
    __tablename__ = "activity_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # The actor who performed the action — admin OR teacher. SET NULL on
    # delete so audit history outlives the account it describes.
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # "admin" | "teacher" — discriminates the two writer classes so a
    # query can scope to just teacher activity.
    actor_role: Mapped[str] = mapped_column(String(20), nullable=False)

    # Denormalized snapshot of the actor's school at write time so the
    # dashboard can filter a whole school's activity cheaply. NULL for
    # global admins with no school.
    school_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("schools.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # "<entity>.<verb>" — e.g., "assignment.publish", "generation.start",
    # "grade.save", "user.delete". Indexed so prefix filters like
    # "grade.*" are cheap.
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Named `action_metadata` because SQLAlchemy reserves `metadata` on
    # the declarative Base. Small JSON only — ids / counts / titles, NOT
    # full student content (deep-link to the record instead).
    action_metadata: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )

    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)

    performed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
