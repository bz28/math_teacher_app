import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    grade_level: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="student")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # School affiliation (teachers only — students connect via section enrollments)
    school_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schools.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    # Subscription
    subscription_tier: Mapped[str] = mapped_column(String(20), nullable=False, default="free")
    subscription_status: Mapped[str] = mapped_column(String(20), nullable=False, default="none")
    subscription_provider: Mapped[str | None] = mapped_column(String(20), nullable=True)
    subscription_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rc_customer_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True, index=True
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True, index=True
    )

    # Daily limit reset (admin override — shifts the "start of day" for usage counting)
    daily_limit_reset_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Password reset
    password_reset_token_hash: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    password_reset_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Brute force protection
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_name: Mapped[str | None] = mapped_column(String(200), nullable=True)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
