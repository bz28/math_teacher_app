"""Admin contact lead management endpoints."""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.contact_lead import ContactLead

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_STATUSES = ("new", "contacted", "converted", "declined")


class UpdateLeadStatusRequest(BaseModel):
    status: str


@router.get("/leads")
async def list_leads(
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    rows = (await db.execute(
        select(ContactLead).order_by(ContactLead.created_at.desc())
    )).scalars().all()

    return {
        "leads": [
            {
                "id": str(lead.id),
                "school_name": lead.school_name,
                "contact_name": lead.contact_name,
                "contact_email": lead.contact_email,
                "role": lead.role,
                "approx_students": lead.approx_students,
                "message": lead.message,
                "status": lead.status,
                "created_at": lead.created_at.isoformat(),
            }
            for lead in rows
        ]
    }


@router.patch("/leads/{lead_id}")
async def update_lead_status(
    lead_id: str,
    body: UpdateLeadStatusRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Status must be one of: {', '.join(VALID_STATUSES)}",
        )

    lead = (await db.execute(select(ContactLead).where(ContactLead.id == lead_id))).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")

    lead.status = body.status
    await db.commit()
    logger.info("AUDIT: admin=%s updated lead=%s status to '%s'", current_user.user_id, lead_id, body.status)
    return {"status": "ok"}
