"""Public contact form endpoint — the website's "talk to us" form.

It emails the admins and keeps no copy: the admin console has no sales
pipeline (leads live in a table in Ben's Blob Space), so the alert email
is the record. Validation and the rate limit stay, since the endpoint is
public and every call sends mail.
"""

import html
import json
import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, EmailStr, Field

from api.config import settings
from api.core.email import deliver_email
from api.middleware.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contact", tags=["contact"])


class ContactFormRequest(BaseModel):
    school_name: str = Field(max_length=200)
    contact_name: str = Field(max_length=200)
    contact_email: EmailStr
    role: str = Field(default="teacher", max_length=100)
    # Bounded to non-negative and sane, so obviously bogus numbers
    # (-5, 99_999_999_999) never reach the admin inbox.
    approx_students: int | None = Field(default=None, ge=0, le=1_000_000)
    message: str | None = Field(default=None, max_length=5000)


def _alert_html(body: ContactFormRequest) -> str:
    """The admin alert. Every user-controlled field is run through
    html.escape — it lands in the admin inbox as HTML, so raw
    interpolation would let a lead inject markup/script (XSS/phishing)."""
    students_line = (
        f"<li><strong>Est. students:</strong> {body.approx_students}</li>" if body.approx_students else ""
    )
    message_line = (
        f"<li><strong>Message:</strong> {html.escape(body.message)}</li>" if body.message else ""
    )
    return (
        f"<h2>New Lead from {html.escape(body.school_name)}</h2>"
        f"<ul>"
        f"<li><strong>Contact:</strong> {html.escape(body.contact_name)}</li>"
        f"<li><strong>Email:</strong> {html.escape(body.contact_email)}</li>"
        f"<li><strong>Role:</strong> {html.escape(body.role)}</li>"
        f"{students_line}"
        f"{message_line}"
        f"</ul>"
        f"<p>This email is the only copy — add it to the Leads table.</p>"
    )


@router.post("/lead")
@limiter.limit("3/minute")
async def submit_contact_form(
    request: Request,
    body: ContactFormRequest,
) -> dict[str, str]:
    logger.info("New contact lead from %s (%s) at %s", body.contact_name, body.contact_email, body.school_name)

    # Awaited, not fire-and-forget: the email is the only copy, so the
    # handler has to know it went. When it didn't (no admin configured, no
    # mail key, Resend failed), the whole inquiry goes to the error log —
    # which alerts — rather than nowhere. The visitor's answer is the same
    # either way: their part is done, and the inquiry is not lost.
    delivered = bool(settings.admin_alert_emails) and await deliver_email(
        to=settings.admin_alert_emails,
        subject=f"New school lead: {body.school_name}",
        html=_alert_html(body),
    )
    if not delivered:
        logger.error(
            "Contact form inquiry NOT emailed (no admin address, no mail key, or the send failed) "
            "— this log line is its only copy: %s",
            json.dumps(body.model_dump(), ensure_ascii=False),
        )

    return {"status": "ok", "message": "Thank you! We'll be in touch soon."}
