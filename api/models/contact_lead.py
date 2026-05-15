"""Contact lead model — tracks both inbound inquiries and outbound /
warm-intro prospects. The lead row is the prospect; meetings and notes
(see lead_meeting.py, lead_note.py) hang off it as the activity log.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class ContactLead(Base):
    __tablename__ = "contact_leads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="teacher")
    approx_students: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Original inbound submission text. Preserved verbatim; only set
    # for source=inbound_form leads (manually-added warm intros leave
    # it null — they put context in the first lead_notes entry).
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="new")
    # How this lead reached us. `inbound_form` is the public /demo
    # form; `warm_intro` / `outbound` / `event` are operator-entered.
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="inbound_form")
    # For warm intros, the human who made the connection. Freeform so
    # we don't need a separate referrers table — the volume doesn't
    # justify normalization yet.
    referred_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    school_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schools.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
