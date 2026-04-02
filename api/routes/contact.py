"""Public contact form endpoint — creates a lead from /teachers page."""

import asyncio
import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.email import send_email
from api.database import get_db
from api.models.contact_lead import ContactLead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contact", tags=["contact"])


class ContactFormRequest(BaseModel):
    school_name: str
    contact_name: str
    contact_email: EmailStr
    role: str = "teacher"
    approx_students: int | None = None
    message: str | None = None


@router.post("/lead")
async def submit_contact_form(
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

    # Fire-and-forget admin notification
    if settings.admin_alert_emails:
        students_line = (
            f"<li><strong>Est. students:</strong> {body.approx_students}</li>" if body.approx_students else ""
        )
        message_line = (
            f"<li><strong>Message:</strong> {body.message}</li>" if body.message else ""
        )
        asyncio.create_task(send_email(
            to=settings.admin_alert_emails,
            subject=f"New school lead: {body.school_name}",
            html=(
                f"<h2>New Lead from {body.school_name}</h2>"
                f"<ul>"
                f"<li><strong>Contact:</strong> {body.contact_name}</li>"
                f"<li><strong>Email:</strong> {body.contact_email}</li>"
                f"<li><strong>Role:</strong> {body.role}</li>"
                f"{students_line}"
                f"{message_line}"
                f"</ul>"
                f'<p><a href="https://admin.veradicai.com/leads">View in dashboard</a></p>'
            ),
        ))

    return {"status": "ok", "message": "Thank you! We'll be in touch soon."}
