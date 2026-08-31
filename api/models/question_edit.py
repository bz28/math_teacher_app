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

## One row per changed FIELD, not per request

A bank item is produced by two separate LLM calls — `generate_questions`
writes the prose, `generate_solutions` (via `decompose`) works the
answer — plus `generate_distractors` for MCQ choices. So "a teacher
changed this item" is not one signal, and a row carries both:

- `kind`  — WHAT they did (typed a fix, used the workshop, asked for a
  redo, binned it)
- `field` — WHICH call it indicts (question / solution / final_answer /
  distractors)

One PATCH that rewrites both the question and the solution emits TWO
rows, because it is evidence against two different prompts.

This is why the earlier question-only design under-reported so badly:
the writer compared `previous_question` to `question` and returned early
when they matched, so a teacher who fixed only the solution produced no
row at all — despite `snapshot_history` having saved the before-value
one line earlier. The evidence was collected and then dropped.

Recorded at the route call sites that perform the mutation, never inside
`snapshot_history` (which only fills the one-level undo).

Figures are still out of scope: `figure_spec`/`figure_svg` are rendered
artifacts of the question, and the harness probes already cover them.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base

# ── kind: WHAT the teacher did ──────────────────────────────────────
# Ordered by severity. A repair says the output was salvageable; a
# fresh regeneration says it wasn't; a rejection says it was wrong
# enough to bin. They must not average into one number.
EDIT_MANUAL = "edit_manual"          # typed the correction themselves
EDIT_WORKSHOP = "edit_workshop"      # accepted a workshop-agent proposal
REGEN_GUIDED = "regen_guided"        # asked for a redo AND said how
REGEN_FRESH = "regen_fresh"          # asked for a redo with no direction
REJECT = "reject"                    # binned the question outright

# `regen_guided` vs `regen_fresh` is not a distinction we invented for
# reporting — `regenerate_one` already branches on it. With no
# instructions it DROPS the "original question to revise" anchor and
# asks for a fresh take; with instructions it keeps the original and
# revises it. Only the first is evidence the prompt produced something
# unusable, so collapsing them would blunt the signal.
# The two kinds that existed before actions were recorded. The generation
# report counts ONLY these, so its numbers keep meaning what they meant
# before regenerate and reject became recordable — a reporting change
# belongs in the commit that redesigns the report, not in the one that
# widens what gets written.
EDIT_KINDS = (EDIT_MANUAL, EDIT_WORKSHOP)

# ── field: WHICH LLM call the row indicts ───────────────────────────
# A bank item is the output of two separate calls (three with MCQ), so
# "a teacher changed this item" is not one signal. Question edits
# indict `generate_questions`; solution and final-answer edits indict
# `decompose`; distractor edits indict `generate_distractors`.
#
# Distractors are NOT tracked, and the omission is deliberate:
# `snapshot_history` has no `previous_distractors`, so there is no
# before-value to diff against. Recording them means first extending
# the teacher-facing one-level undo — a separate change with its own
# revert semantics. Until then, `generate_distractors` has no signal,
# and that gap should not be mistaken for "teachers never fix choices".
FIELD_QUESTION = "question"
FIELD_SOLUTION = "solution"
FIELD_FINAL_ANSWER = "final_answer"

# When recording began. Deliberately a constant rather than a stored
# row: it is a fact about the deploy, not about any question, and the
# admin API returns it so a count of 0 can be read as "not tracked then"
# instead of "never edited".
#
# This is the MERGE time, not the date the code was written. It was
# briefly set five days early, which would have had the page assert
# it was counting across a window in which nothing was recorded —
# the precise misreading the constant exists to prevent.
TRACKING_SINCE = datetime(2026, 8, 2, 18, 16, tzinfo=UTC)


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

    # What the teacher did — one of the EDIT_/REGEN_/REJECT constants
    # above, ordered by severity. See the module docstring.
    kind: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    # Which LLM call this row indicts — one of the FIELD_ constants.
    # A bank item comes from two calls, so without this a solution
    # repair and a question repair are indistinguishable.
    field: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    # The text either side of the change, for the `field` named above.
    # `before` is null when there was no prior value; `after` is null on
    # a reject, where nothing replaced it. Solution steps and distractors
    # are serialized to text — these are read by a human debugging a
    # prompt, not re-parsed.
    before: Mapped[str | None] = mapped_column(Text, nullable=True)
    after: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
        index=True,
    )
