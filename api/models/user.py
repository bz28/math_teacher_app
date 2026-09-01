import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
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

    # Self-reported school name from teacher self-signup. Free-text,
    # not normalized — used as a sales signal (which schools have
    # teachers organically trying Veradic) rather than as a real
    # institutional link. The formal `school_id` FK above remains the
    # source of truth for school membership.
    signup_school_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Shadow student for the teacher's "Preview as student" mode.
    is_preview: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    preview_owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
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
    # Latest active Stripe subscription id. Webhook handlers use this
    # to ignore events for older / superseded subscriptions — without
    # it, a late-arriving subscription.updated(active) after
    # subscription.deleted would re-promote a cancelled user.
    stripe_subscription_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True,
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

    # MFA (email-based one-time codes). See api/core/mfa.py for the flow.
    # mfa_enabled is opt-in via /auth/mfa/enable; mfa_code_* track an
    # in-flight challenge between /auth/login and /auth/login/verify-mfa.
    mfa_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    mfa_code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mfa_code_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    mfa_code_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    # Onboarding tours the user has already seen, keyed by persona
    # ("teacher" | "student" | "personal"). A persona's
    # first-run tour auto-mounts only while its key is absent; the menu
    # "Take the tour" re-entry never clears these. Stored as a JSON
    # array rather than a join table — the set is tiny and read on every
    # /auth/me. Always reassign (don't .append) so the ORM flags the
    # in-place mutation as dirty.
    tours_seen: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )

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
