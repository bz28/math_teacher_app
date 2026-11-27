"""Public contact form endpoint — the website's "talk to us" form.

It emails the admins and keeps no copy: the admin console has no sales
pipeline (leads live in a table in Ben's Blob Space), so the alert email
is the record. Validation and the rate limit stay, since the endpoint is
public and every call sends mail.
"""

import asyncio
import html
import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, EmailStr, Field

from api.config import settings
from api.core.email import send_email
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


@router.post("/lead")
@limiter.limit("3/minute")
async def submit_contact_form(
    request: Request,
    body: ContactFormRequest,
) -> dict[str, str]:
    logger.info("New contact lead from %s (%s) at %s", body.contact_name, body.contact_email, body.school_name)

    # Fire-and-forget admin notification. Every user-controlled field is run
    # through html.escape — these land in the admin inbox as HTML, so raw
    # interpolation would let a lead inject markup/script (XSS/phishing).
    if not settings.admin_alert_emails:
        # Nothing else keeps the inquiry, so say loudly that it went nowhere.
        logger.warning("Contact form from %s has no admin to email (ADMIN_ALERT_EMAILS empty)", body.school_name)
    else:
        safe_school = html.escape(body.school_name)
        safe_contact = html.escape(body.contact_name)
        safe_email = html.escape(body.contact_email)
        safe_role = html.escape(body.role)
        students_line = (
            f"<li><strong>Est. students:</strong> {body.approx_students}</li>" if body.approx_students else ""
        )
        message_line = (
            f"<li><strong>Message:</strong> {html.escape(body.message)}</li>" if body.message else ""
        )
        asyncio.create_task(send_email(
            to=settings.admin_alert_emails,
            subject=f"New school lead: {body.school_name}",
            html=(
                f"<h2>New Lead from {safe_school}</h2>"
                f"<ul>"
                f"<li><strong>Contact:</strong> {safe_contact}</li>"
                f"<li><strong>Email:</strong> {safe_email}</li>"
                f"<li><strong>Role:</strong> {safe_role}</li>"
                f"{students_line}"
                f"{message_line}"
                f"</ul>"
                f"<p>This email is the only copy — add it to the Leads table.</p>"
            ),
        ))

    return {"status": "ok", "message": "Thank you! We'll be in touch soon."}
