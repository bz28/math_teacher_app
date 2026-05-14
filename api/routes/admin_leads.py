"""Admin contact lead management endpoints."""

import logging
import uuid as _uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.contact_lead import ContactLead

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_STATUSES = ("new", "contacted", "converted", "declined")


class UpdateLeadRequest(BaseModel):
    """All admin-editable fields on a lead.

    `status` is the original (and most common) edit; the rest are
    discovery-context the operator picks up after the form submission
    and wants to record without touching the inbound `message`.
    """

    status: str | None = None
    school_id: str | None = None
    approx_students: int | None = Field(default=None, ge=0)
    notes: str | None = None


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
                "notes": lead.notes,
                "status": lead.status,
                "created_at": lead.created_at.isoformat(),
                "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
                "updated_by": lead.updated_by_name,
                "school_id": str(lead.school_id) if lead.school_id else None,
            }
            for lead in rows
        ]
    }


@router.patch("/leads/{lead_id}")
async def update_lead(
    lead_id: str,
    body: UpdateLeadRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if body.status is not None and body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Status must be one of: {', '.join(VALID_STATUSES)}",
        )

    lead = (await db.execute(
        select(ContactLead).where(ContactLead.id == lead_id)
    )).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")

    # Pull patch_fields out of body.model_dump so we touch only the
    # keys the client actually sent — pydantic's `exclude_unset` keeps
    # unset fields from clobbering existing values with None.
    fields = body.model_dump(exclude_unset=True)
    if "status" in fields:
        lead.status = fields["status"]
    if "school_id" in fields and fields["school_id"]:
        lead.school_id = _uuid.UUID(fields["school_id"])
    if "approx_students" in fields:
        lead.approx_students = fields["approx_students"]
    if "notes" in fields:
        lead.notes = fields["notes"]

    lead.updated_at = func.now()
    lead.updated_by_id = current_user.user_id
    lead.updated_by_name = current_user.name
    await db.commit()
    # Log the actual values, not just the field names — forensics on
    # "who set this school's notes to X" needs the value too. Notes
    # can be long; truncate to keep log lines bounded.
    audit_values = {
        k: (v[:120] + "…" if isinstance(v, str) and len(v) > 120 else v)
        for k, v in fields.items()
    }
    logger.info(
        "AUDIT: admin=%s updated lead=%s fields=%s",
        current_user.user_id, lead_id, audit_values,
    )
    return {"status": "ok"}
