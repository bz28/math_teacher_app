"""Admin audit-log model.

One row per administrative action (delete, role change, export,
school deactivation, etc.). Written by
`api.core.audit_log.log_admin_action`. Queried by ops/leadership and
during district procurement audits.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    admin_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    admin_role: Mapped[str] = mapped_column(String(20), nullable=False)

    # "<entity>.<verb>" — e.g., "user.delete", "user.role_change",
    # "school.deactivate", "lead.export". Indexed so prefix filters
    # like "user.*" are cheap.
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Named `action_metadata` because SQLAlchemy reserves `metadata` on
    # the declarative Base. Each action stamps whatever JSON makes
    # sense — old role / new role for role changes, summary stats for
    # exports, deletion-confirmation parameters for deletes, etc.
    action_metadata: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )

    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)

    performed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
