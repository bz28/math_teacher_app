"""FERPA audit-log model.

One row per teacher/admin access to a student record (submission,
grade, integrity flag, session, etc.). Written by
`api.core.audit_log.log_student_record_access` from the relevant
read endpoints. Queried by district admins via the audit endpoint
to satisfy FERPA disclosure-tracking requirements.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class StudentRecordAccessLog(Base):
    __tablename__ = "student_record_access_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Both FKs use SET NULL on delete so audit history survives user
    # removal. FERPA logs need to outlast the accounts they describe.
    accessor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    accessor_role: Mapped[str] = mapped_column(String(20), nullable=False)

    target_student_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Free-form category — "submission", "grade", "integrity_flag",
    # "session", "assignment", etc. Callers stamp consistent values;
    # downstream queries group by this column.
    record_type: Mapped[str] = mapped_column(String(40), nullable=False)
    record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    school_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("schools.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # IPv6 max length is 45. Optional — populated when the caller has a
    # request object handy.
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)

    accessed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index(
            "ix_student_record_access_log_target_time",
            "target_student_id",
            "accessed_at",
        ),
    )
