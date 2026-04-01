"""Public contact form endpoint — creates a lead from /teachers page."""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

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

    # TODO: Send email notification to admin when email service is configured
    logger.info("New contact lead from %s (%s) at %s", body.contact_name, body.contact_email, body.school_name)

    return {"status": "ok", "message": "Thank you! We'll be in touch soon."}
