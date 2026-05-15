"""Admin contact lead management endpoints.

Leads are the operator-facing view of every prospect — both inbound
form submissions and manually-entered warm intros. Each lead carries
a timeline of meetings (lead_meetings) and notes (lead_notes); the
list endpoint surfaces "next action" and "last touch" derived from
those so the operator can scan the funnel at a glance.
"""

import logging
import uuid as _uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.contact_lead import ContactLead
from api.models.lead_meeting import LeadMeeting
from api.models.lead_note import LeadNote

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_STATUSES = ("new", "contacted", "engaged", "demo_held", "converted", "declined")
VALID_SOURCES = ("inbound_form", "warm_intro", "outbound", "event")
MEETING_TYPES = ("demo", "follow_up", "onboarding", "other")


# ── Schemas ──────────────────────────────────────────────────────────────────


class CreateLeadRequest(BaseModel):
    school_name: str
    contact_name: str
    contact_email: EmailStr
    role: str = "teacher"
    source: str = "warm_intro"
    referred_by: str | None = None
    approx_students: int | None = Field(default=None, ge=0, le=1_000_000)
    initial_note: str | None = None


class UpdateLeadRequest(BaseModel):
    """All admin-editable fields on a lead.

    `status` is the most common edit; `source` and `referred_by`
    track origin metadata you sometimes correct after the fact;
    `school_id` is set by the convert-to-school flow.
    """

    status: str | None = None
    source: str | None = None
    referred_by: str | None = None
    school_id: str | None = None
    approx_students: int | None = Field(default=None, ge=0, le=1_000_000)


class CreateMeetingRequest(BaseModel):
    type: str
    scheduled_at: datetime
    agenda: str | None = None
    # For after-the-fact logging: if both are set at creation time the
    # meeting goes straight to HELD without a separate mark-held step.
    held_at: datetime | None = None
    outcome: str | None = None


class UpdateMeetingRequest(BaseModel):
    type: str | None = None
    scheduled_at: datetime | None = None
    agenda: str | None = None
    held_at: datetime | None = None
    outcome: str | None = None
    cancelled_at: datetime | None = None


class NoteRequest(BaseModel):
    body: str = Field(min_length=1)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _serialize_meeting(m: LeadMeeting) -> dict[str, Any]:
    return {
        "id": str(m.id),
        "type": m.type,
        "scheduled_at": m.scheduled_at.isoformat(),
        "held_at": m.held_at.isoformat() if m.held_at else None,
        "cancelled_at": m.cancelled_at.isoformat() if m.cancelled_at else None,
        "agenda": m.agenda,
        "outcome": m.outcome,
        "created_at": m.created_at.isoformat(),
        "created_by": m.created_by_name,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
        "updated_by": m.updated_by_name,
    }


def _serialize_note(n: LeadNote) -> dict[str, Any]:
    return {
        "id": str(n.id),
        "body": n.body,
        "created_at": n.created_at.isoformat(),
        "created_by": n.created_by_name,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
    }


def _serialize_lead(lead: ContactLead) -> dict[str, Any]:
    return {
        "id": str(lead.id),
        "school_name": lead.school_name,
        "contact_name": lead.contact_name,
        "contact_email": lead.contact_email,
        "role": lead.role,
        "approx_students": lead.approx_students,
        "message": lead.message,
        "status": lead.status,
        "source": lead.source,
        "referred_by": lead.referred_by,
        "created_at": lead.created_at.isoformat(),
        "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
        "updated_by": lead.updated_by_name,
        "school_id": str(lead.school_id) if lead.school_id else None,
    }


async def _load_lead_or_404(db: AsyncSession, lead_id: str) -> ContactLead:
    try:
        lead_uuid = _uuid.UUID(lead_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid lead id") from e
    lead = (await db.execute(
        select(ContactLead).where(ContactLead.id == lead_uuid)
    )).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    return lead


async def _load_meeting_or_404(
    db: AsyncSession, lead_id: _uuid.UUID, meeting_id: str
) -> LeadMeeting:
    try:
        meeting_uuid = _uuid.UUID(meeting_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid meeting id") from e
    meeting = (await db.execute(
        select(LeadMeeting).where(
            LeadMeeting.id == meeting_uuid, LeadMeeting.lead_id == lead_id,
        )
    )).scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return meeting


async def _load_note_or_404(
    db: AsyncSession, lead_id: _uuid.UUID, note_id: str
) -> LeadNote:
    try:
        note_uuid = _uuid.UUID(note_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid note id") from e
    note = (await db.execute(
        select(LeadNote).where(
            LeadNote.id == note_uuid, LeadNote.lead_id == lead_id,
        )
    )).scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    return note


def _compute_next_meeting(meetings: list[LeadMeeting], now: datetime) -> LeadMeeting | None:
    """Earliest meeting that's not cancelled and not yet held.

    Past-but-unmarked meetings still count as "next action" — the
    operator hasn't told us whether they happened, so the row should
    nudge them to resolve it.
    """
    candidates = [
        m for m in meetings
        if m.cancelled_at is None and m.held_at is None
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda m: m.scheduled_at)


def _compute_last_touch(
    lead: ContactLead, meetings: list[LeadMeeting], notes: list[LeadNote],
) -> tuple[datetime, str]:
    """Latest activity timestamp + a label saying which kind."""
    candidates: list[tuple[datetime, str]] = [(lead.created_at, "created")]
    for m in meetings:
        if m.held_at is not None:
            candidates.append((m.held_at, "meeting"))
    for n in notes:
        candidates.append((n.created_at, "note"))
    return max(candidates, key=lambda t: t[0])


# ── Leads CRUD ───────────────────────────────────────────────────────────────


@router.get("/leads")
async def list_leads(
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _ = current_user
    leads = (await db.execute(
        select(ContactLead).order_by(ContactLead.created_at.desc())
    )).scalars().all()

    # Bulk-load meetings and notes for all leads to avoid N+1. At our
    # scale (<100 leads pre-launch) this is well under a millisecond.
    lead_ids = [lead.id for lead in leads]
    meetings_by_lead: dict[_uuid.UUID, list[LeadMeeting]] = {lid: [] for lid in lead_ids}
    notes_by_lead: dict[_uuid.UUID, list[LeadNote]] = {lid: [] for lid in lead_ids}
    if lead_ids:
        for m in (await db.execute(
            select(LeadMeeting).where(LeadMeeting.lead_id.in_(lead_ids))
        )).scalars().all():
            meetings_by_lead[m.lead_id].append(m)
        for n in (await db.execute(
            select(LeadNote).where(LeadNote.lead_id.in_(lead_ids))
        )).scalars().all():
            notes_by_lead[n.lead_id].append(n)

    now = datetime.now(UTC)
    rows: list[dict[str, Any]] = []
    for lead in leads:
        meetings = meetings_by_lead[lead.id]
        notes = notes_by_lead[lead.id]
        next_m = _compute_next_meeting(meetings, now)
        last_at, last_kind = _compute_last_touch(lead, meetings, notes)
        row = _serialize_lead(lead)
        row["next_meeting_at"] = next_m.scheduled_at.isoformat() if next_m else None
        row["next_meeting_type"] = next_m.type if next_m else None
        row["last_touch_at"] = last_at.isoformat()
        row["last_touch_kind"] = last_kind
        rows.append(row)

    return {"leads": rows}


@router.post("/leads")
async def create_lead(
    body: CreateLeadRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if body.source not in VALID_SOURCES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"source must be one of: {', '.join(VALID_SOURCES)}",
        )

    lead = ContactLead(
        school_name=body.school_name.strip(),
        contact_name=body.contact_name.strip(),
        contact_email=body.contact_email.lower(),
        role=body.role.strip() or "teacher",
        source=body.source,
        referred_by=body.referred_by.strip() if body.referred_by else None,
        approx_students=body.approx_students,
    )
    db.add(lead)
    await db.flush()

    if body.initial_note and body.initial_note.strip():
        db.add(LeadNote(
            lead_id=lead.id,
            body=body.initial_note.strip(),
            created_by_id=current_user.user_id,
            created_by_name=current_user.name,
        ))

    await db.commit()
    logger.info(
        "AUDIT: admin=%s created lead=%s school=%s source=%s",
        current_user.user_id, lead.id, lead.school_name, lead.source,
    )
    return {"id": str(lead.id), "status": "ok"}


@router.get("/leads/{lead_id}")
async def get_lead(
    lead_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _ = current_user
    lead = await _load_lead_or_404(db, lead_id)

    meetings = (await db.execute(
        select(LeadMeeting)
        .where(LeadMeeting.lead_id == lead.id)
        .order_by(LeadMeeting.scheduled_at.desc())
    )).scalars().all()
    notes = (await db.execute(
        select(LeadNote)
        .where(LeadNote.lead_id == lead.id)
        .order_by(LeadNote.created_at.desc())
    )).scalars().all()

    payload = _serialize_lead(lead)
    payload["meetings"] = [_serialize_meeting(m) for m in meetings]
    payload["notes"] = [_serialize_note(n) for n in notes]
    return payload


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
            detail=f"status must be one of: {', '.join(VALID_STATUSES)}",
        )
    if body.source is not None and body.source not in VALID_SOURCES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"source must be one of: {', '.join(VALID_SOURCES)}",
        )

    lead = await _load_lead_or_404(db, lead_id)

    # exclude_unset keeps the patch tight — clients omit fields they
    # don't want to touch, and None means "explicitly clear it" only
    # for nullable fields like referred_by.
    fields = body.model_dump(exclude_unset=True)
    if "status" in fields:
        lead.status = fields["status"]
    if "source" in fields:
        lead.source = fields["source"]
    if "referred_by" in fields:
        lead.referred_by = fields["referred_by"]
    if "school_id" in fields and fields["school_id"]:
        try:
            lead.school_id = _uuid.UUID(fields["school_id"])
        except ValueError as e:
            raise HTTPException(status_code=400, detail="Invalid school_id") from e
    if "approx_students" in fields:
        lead.approx_students = fields["approx_students"]

    lead.updated_at = func.now()
    lead.updated_by_id = current_user.user_id
    lead.updated_by_name = current_user.name
    await db.commit()
    logger.info(
        "AUDIT: admin=%s updated lead=%s fields=%s",
        current_user.user_id, lead_id, list(fields.keys()),
    )
    return {"status": "ok"}


@router.delete("/leads/{lead_id}")
async def delete_lead(
    lead_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    lead = await _load_lead_or_404(db, lead_id)
    school_name = lead.school_name
    await db.delete(lead)
    await db.commit()
    logger.info(
        "AUDIT: admin=%s deleted lead=%s (%s)",
        current_user.user_id, lead_id, school_name,
    )
    return {"status": "ok"}


# ── Meetings ─────────────────────────────────────────────────────────────────


@router.post("/leads/{lead_id}/meetings")
async def create_meeting(
    lead_id: str,
    body: CreateMeetingRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if body.type not in MEETING_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"type must be one of: {', '.join(MEETING_TYPES)}",
        )

    lead = await _load_lead_or_404(db, lead_id)
    meeting = LeadMeeting(
        lead_id=lead.id,
        type=body.type,
        scheduled_at=body.scheduled_at,
        agenda=body.agenda.strip() if body.agenda else None,
        held_at=body.held_at,
        outcome=body.outcome.strip() if body.outcome else None,
        created_by_id=current_user.user_id,
        created_by_name=current_user.name,
    )
    db.add(meeting)
    await db.commit()
    logger.info(
        "AUDIT: admin=%s created meeting=%s lead=%s type=%s",
        current_user.user_id, meeting.id, lead_id, meeting.type,
    )
    return {"id": str(meeting.id), "status": "ok"}


@router.patch("/leads/{lead_id}/meetings/{meeting_id}")
async def update_meeting(
    lead_id: str,
    meeting_id: str,
    body: UpdateMeetingRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if body.type is not None and body.type not in MEETING_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"type must be one of: {', '.join(MEETING_TYPES)}",
        )

    lead = await _load_lead_or_404(db, lead_id)
    meeting = await _load_meeting_or_404(db, lead.id, meeting_id)

    fields = body.model_dump(exclude_unset=True)
    for key in ("type", "scheduled_at", "agenda", "held_at", "outcome", "cancelled_at"):
        if key in fields:
            value = fields[key]
            if isinstance(value, str):
                value = value.strip() or None
            setattr(meeting, key, value)

    meeting.updated_at = func.now()
    meeting.updated_by_id = current_user.user_id
    meeting.updated_by_name = current_user.name
    await db.commit()
    logger.info(
        "AUDIT: admin=%s updated meeting=%s lead=%s fields=%s",
        current_user.user_id, meeting_id, lead_id, list(fields.keys()),
    )
    return {"status": "ok"}


@router.delete("/leads/{lead_id}/meetings/{meeting_id}")
async def delete_meeting(
    lead_id: str,
    meeting_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    lead = await _load_lead_or_404(db, lead_id)
    meeting = await _load_meeting_or_404(db, lead.id, meeting_id)
    await db.delete(meeting)
    await db.commit()
    logger.info(
        "AUDIT: admin=%s deleted meeting=%s lead=%s",
        current_user.user_id, meeting_id, lead_id,
    )
    return {"status": "ok"}


# ── Notes ────────────────────────────────────────────────────────────────────


@router.post("/leads/{lead_id}/notes")
async def create_note(
    lead_id: str,
    body: NoteRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    lead = await _load_lead_or_404(db, lead_id)
    note = LeadNote(
        lead_id=lead.id,
        body=body.body.strip(),
        created_by_id=current_user.user_id,
        created_by_name=current_user.name,
    )
    db.add(note)
    await db.commit()
    logger.info(
        "AUDIT: admin=%s created note=%s lead=%s",
        current_user.user_id, note.id, lead_id,
    )
    return {"id": str(note.id), "status": "ok"}


@router.patch("/leads/{lead_id}/notes/{note_id}")
async def update_note(
    lead_id: str,
    note_id: str,
    body: NoteRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    lead = await _load_lead_or_404(db, lead_id)
    note = await _load_note_or_404(db, lead.id, note_id)
    note.body = body.body.strip()
    note.updated_at = func.now()
    await db.commit()
    logger.info(
        "AUDIT: admin=%s updated note=%s lead=%s",
        current_user.user_id, note_id, lead_id,
    )
    return {"status": "ok"}


@router.delete("/leads/{lead_id}/notes/{note_id}")
async def delete_note(
    lead_id: str,
    note_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    lead = await _load_lead_or_404(db, lead_id)
    note = await _load_note_or_404(db, lead.id, note_id)
    await db.delete(note)
    await db.commit()
    logger.info(
        "AUDIT: admin=%s deleted note=%s lead=%s",
        current_user.user_id, note_id, lead_id,
    )
    return {"status": "ok"}
