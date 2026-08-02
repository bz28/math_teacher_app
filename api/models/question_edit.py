"""QuestionEdit — one row per change a teacher made to a generated question.

## Why this exists

A generated question a teacher had to rewrite is the single clearest
signal that the GENERATION PROMPT is wrong. One teacher fixing one
question is taste; four teachers fixing the same kind of question is a
defect we can go and fix at the source.

Nothing recorded that. `QuestionBankItem` carries a `previous_*` family,
but it is a ONE-LEVEL UNDO — the second edit overwrites the first
snapshot — so "this was edited four times" was not answerable, and the
first three edits were already gone. The workshop chat kept its own
transcript, so agent-driven changes were partly recoverable; hand-edits
left nothing but the latest undo slot.

## No backfill is possible, and the API says so

Every other migration in this repo backfills, because the data existed
and only the column was new. Here the EVENTS were never recorded. There
is nothing to reconstruct from: the intermediate states are gone.

So the honest thing is to say when counting started rather than let a
zero read as "this question was never touched" — which would quietly
mislead exactly the analysis this table exists to support. Admin
responses carry `TRACKING_SINCE`; the UI shows "tracking began …".

## One row per edit, keyed by kind

The three ways a question changes all funnel through `snapshot_history`,
which is where these are written:

- `manual`     — teacher edited the fields directly (PATCH)
- `chat`       — teacher accepted a proposal from the workshop agent
- `regenerate` — teacher asked for a fresh AI attempt

`before`/`after` hold the question text only. Not the whole item: the
question is what the prompt produced and what the teacher judged, and
storing solution steps and figures too would multiply the row size for
something no analysis reads.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base

EDIT_MANUAL = "manual"
EDIT_CHAT = "chat"
EDIT_REGENERATE = "regenerate"

# When recording began. Deliberately a constant rather than a stored
# row: it is a fact about the deploy, not about any question, and the
# admin API returns it so a count of 0 can be read as "not tracked then"
# instead of "never edited". Set to the date the migration shipped.
TRACKING_SINCE = datetime(2026, 7, 28, tzinfo=UTC)


class QuestionEdit(Base):
    __tablename__ = "question_edits"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )

    bank_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_bank_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Denormalized so the admin console can filter by teacher and school
    # without joining back through course → teacher → school on every
    # row. Snapshot semantics, matching how `llm_calls` does it: an edit
    # keeps the school it was made in even if the teacher later moves.
    edited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    school_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("schools.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # manual / chat / regenerate — see the module docstring.
    kind: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    # The question text either side of the change. `before` is null on a
    # regenerate that had no prior text. Question only, not the whole
    # item — see the module docstring.
    before: Mapped[str | None] = mapped_column(Text, nullable=True)
    after: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
        index=True,
    )
