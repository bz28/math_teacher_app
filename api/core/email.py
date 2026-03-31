"""Thin wrapper around Resend for sending admin alert emails."""

from __future__ import annotations

import asyncio
import logging

from api.config import settings

logger = logging.getLogger(__name__)

_background_tasks: set[asyncio.Task[None]] = set()


def _task_done(task: asyncio.Task[None]) -> None:
    _background_tasks.discard(task)
    if not task.cancelled() and task.exception():
        logger.error("Email send failed: %s", task.exception())


async def _send(to: str, subject: str, html: str) -> None:
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not set — skipping email: %s", subject)
        return

    import resend

    resend.api_key = settings.resend_api_key
    try:
        resend.Emails.send({
            "from": settings.email_from_address,
            "to": [to],
            "subject": subject,
            "html": html,
        })
        logger.info("Email sent: %s -> %s", subject, to)
    except Exception:
        logger.exception("Failed to send email: %s -> %s", subject, to)


def send_email(to: str, subject: str, html: str) -> None:
    """Fire-and-forget email send — non-blocking."""
    try:
        task = asyncio.get_running_loop().create_task(_send(to, subject, html))
        _background_tasks.add(task)
        task.add_done_callback(_task_done)
    except RuntimeError:
        logger.warning("No running event loop — skipping email: %s", subject)
