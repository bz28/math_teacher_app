"""Async email service using Resend."""

import asyncio
import logging

import resend

from api.config import settings

logger = logging.getLogger(__name__)


def _configure() -> bool:
    """Set API key and return True if email is available."""
    if not settings.resend_api_key:
        return False
    resend.api_key = settings.resend_api_key
    return True


async def send_email(*, to: list[str], subject: str, html: str) -> None:
    """Send an email via Resend. Logs and swallows errors so callers never crash."""
    if not _configure():
        logger.warning("RESEND_API_KEY not set — skipping email to %s", to)
        return

    try:
        await asyncio.to_thread(
            resend.Emails.send,
            {
                "from": settings.email_from_address,
                "to": to,
                "subject": subject,
                "html": html,
            },
        )
        logger.info("Email sent to %s — subject: %s", to, subject)
    except Exception:
        logger.exception("Failed to send email to %s — subject: %s", to, subject)
