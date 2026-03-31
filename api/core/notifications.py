"""Admin notification dispatcher.

Checks admin preferences before sending emails. If no preferences
exist for an admin, notifications are sent by default (opt-out model).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.email import send_email
from api.models.notification import AdminNotificationPref
from api.models.user import User

logger = logging.getLogger(__name__)

# All supported event types
EVENT_NEW_USER_SIGNUP = "new_user_signup"
EVENT_DAILY_COST_ALERT = "daily_cost_alert"
EVENT_DAILY_DIGEST = "daily_digest"
EVENT_ERROR_SPIKE = "error_spike"

ALL_EVENT_TYPES = [
    EVENT_NEW_USER_SIGNUP,
    EVENT_DAILY_COST_ALERT,
    EVENT_DAILY_DIGEST,
    EVENT_ERROR_SPIKE,
]

EVENT_LABELS: dict[str, str] = {
    EVENT_NEW_USER_SIGNUP: "New User Signup",
    EVENT_DAILY_COST_ALERT: "Daily Cost Alert",
    EVENT_DAILY_DIGEST: "Daily Digest",
    EVENT_ERROR_SPIKE: "Error Spike",
}


async def _get_admin_emails_for_event(db: AsyncSession, event_type: str) -> list[str]:
    """Return admin email addresses that should receive this event."""
    # Get all admins
    admins_result = await db.execute(select(User).where(User.role == "admin", User.is_active.is_(True)))
    admins = list(admins_result.scalars().all())

    if not admins:
        return []

    # Check preferences for each admin
    emails: list[str] = []
    for admin in admins:
        pref_result = await db.execute(
            select(AdminNotificationPref).where(
                AdminNotificationPref.user_id == admin.id,
                AdminNotificationPref.event_type == event_type,
            )
        )
        pref = pref_result.scalar_one_or_none()

        # Opt-out model: send if no preference exists, or if explicitly enabled
        if pref is None or pref.enabled:
            emails.append(admin.email)

    return emails


async def notify_new_user_signup(db: AsyncSession, user: User) -> None:
    """Send notification when a new user registers."""
    emails = await _get_admin_emails_for_event(db, EVENT_NEW_USER_SIGNUP)
    if not emails:
        return

    subject = f"New user signup: {user.name or user.email}"
    html = f"""
    <div style="font-family: sans-serif; max-width: 500px;">
        <h2 style="color: #2563eb;">New User Signup</h2>
        <table style="border-collapse: collapse; width: 100%;">
            <tr><td style="padding: 8px; font-weight: bold;">Name</td><td style="padding: 8px;">{user.name}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Email</td><td style="padding: 8px;">{user.email}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Grade</td><td style="padding: 8px;">{user.grade_level}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Time</td><td style="padding: 8px;">{datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")}</td></tr>
        </table>
    </div>
    """
    for email in emails:
        send_email(email, subject, html)


async def notify_daily_cost_alert(db: AsyncSession, current_spend: float, limit: float) -> None:
    """Send alert when daily cost exceeds the limit."""
    emails = await _get_admin_emails_for_event(db, EVENT_DAILY_COST_ALERT)
    if not emails:
        return

    pct = (current_spend / limit * 100) if limit > 0 else 0
    subject = f"Cost alert: ${current_spend:.2f} ({pct:.0f}% of ${limit:.2f} limit)"
    html = f"""
    <div style="font-family: sans-serif; max-width: 500px;">
        <h2 style="color: #dc2626;">Daily Cost Alert</h2>
        <p>LLM spending has reached <strong>${current_spend:.2f}</strong>,
        which is <strong>{pct:.0f}%</strong> of the ${limit:.2f} daily limit.</p>
        <p style="color: #6b7280; font-size: 14px;">{datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")}</p>
    </div>
    """
    for email in emails:
        send_email(email, subject, html)


async def notify_daily_digest(
    db: AsyncSession,
    *,
    new_users: int,
    total_sessions: int,
    total_cost: float,
    error_count: int,
) -> None:
    """Send daily summary digest to admins."""
    emails = await _get_admin_emails_for_event(db, EVENT_DAILY_DIGEST)
    if not emails:
        return

    date_str = datetime.now(UTC).strftime("%Y-%m-%d")
    subject = f"Daily digest — {date_str}"
    html = f"""
    <div style="font-family: sans-serif; max-width: 500px;">
        <h2 style="color: #2563eb;">Daily Digest — {date_str}</h2>
        <table style="border-collapse: collapse; width: 100%;">
            <tr><td style="padding: 8px; font-weight: bold;">New users</td><td style="padding: 8px;">{new_users}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Sessions</td><td style="padding: 8px;">{total_sessions}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">LLM cost</td><td style="padding: 8px;">${total_cost:.2f}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Errors</td><td style="padding: 8px;">{error_count}</td></tr>
        </table>
    </div>
    """
    for email in emails:
        send_email(email, subject, html)


async def notify_error_spike(db: AsyncSession, error_count: int, window_minutes: int = 60) -> None:
    """Send alert when error count spikes."""
    emails = await _get_admin_emails_for_event(db, EVENT_ERROR_SPIKE)
    if not emails:
        return

    subject = f"Error spike: {error_count} failures in the last {window_minutes}min"
    html = f"""
    <div style="font-family: sans-serif; max-width: 500px;">
        <h2 style="color: #dc2626;">Error Spike Detected</h2>
        <p><strong>{error_count}</strong> LLM call failures in the last {window_minutes} minutes.</p>
        <p>Check the <a href="{settings.cors_origins[0] if settings.cors_origins else '#'}/llm-calls">LLM Calls dashboard</a> for details.</p>
        <p style="color: #6b7280; font-size: 14px;">{datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")}</p>
    </div>
    """
    for email in emails:
        send_email(email, subject, html)
