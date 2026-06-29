"""Public contact form endpoint — creates a lead from /teachers page."""

import asyncio
import html
import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.email import send_email
from api.database import get_db
from api.middleware.rate_limit import limiter
from api.models.contact_lead import ContactLead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contact", tags=["contact"])


class ContactFormRequest(BaseModel):
    school_name: str = Field(max_length=200)
    contact_name: str = Field(max_length=200)
    contact_email: EmailStr
    role: str = Field(default="teacher", max_length=100)
    # Bounded to non-negative and well under postgres int — symmetric
    # with the admin PATCH validator. Stops obviously bogus inbound
    # numbers (-5, 99_999_999_999) from landing in the DB.
    approx_students: int | None = Field(default=None, ge=0, le=1_000_000)
    message: str | None = Field(default=None, max_length=5000)


@router.post("/lead")
@limiter.limit("3/minute")
async def submit_contact_form(
    request: Request,
    body: ContactFormRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    lead = ContactLead(
        school_name=body.school_name.strip(),
        contact_name=body.contact_name.strip(),
        contact_email=body.contact_email.lower(),
        role=body.role.strip(),
        approx_students=body.approx_students,
        message=body.message.strip() if body.message else None,
    )
    db.add(lead)
    await db.commit()

    logger.info("New contact lead from %s (%s) at %s", body.contact_name, body.contact_email, body.school_name)

    # Fire-and-forget admin notification. Every user-controlled field is run
    # through html.escape — these land in the admin inbox as HTML, so raw
    # interpolation would let a lead inject markup/script (XSS/phishing).
    if settings.admin_alert_emails:
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
                f'<p><a href="https://admin.veradicai.com/leads">View in dashboard</a></p>'
            ),
        ))

    return {"status": "ok", "message": "Thank you! We'll be in touch soon."}
