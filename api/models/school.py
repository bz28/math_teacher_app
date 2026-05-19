"""School model — represents a partner school in the B2B system."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base

# Allowed values for `kind`.
#  - `institutional` — a real partner school provisioned by an admin or
#    site-license signup. Visible in admin school lists, gives its
#    teachers and students the institutional pro-tier bypass.
#  - `individual` — a synthetic personal school auto-created at teacher
#    self-signup so every teacher/student has a school_id. Hidden from
#    admin school lists; teachers backed by one stay on the free-tier
#    daily caps (this is the indie-teacher signal post-refactor).
SCHOOL_KIND_INSTITUTIONAL = "institutional"
SCHOOL_KIND_INDIVIDUAL = "individual"
SCHOOL_KINDS = (SCHOOL_KIND_INSTITUTIONAL, SCHOOL_KIND_INDIVIDUAL)


class School(Base):
    __tablename__ = "schools"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # See SCHOOL_KIND_* constants. Defaults to 'institutional' so any
    # row created without specifying kind (admin /schools POST, tests
    # using the School fixture) lands as a real school — which matches
    # the pre-`kind` invariant. Indie teacher self-signup explicitly
    # opts in to 'individual'.
    kind: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=SCHOOL_KIND_INSTITUTIONAL,
        default=SCHOOL_KIND_INSTITUTIONAL,
    )
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(50), nullable=True)
    contact_name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    __table_args__ = (
        CheckConstraint(
            f"kind IN ('{SCHOOL_KIND_INSTITUTIONAL}', '{SCHOOL_KIND_INDIVIDUAL}')",
            name="ck_schools_kind",
        ),
    )
