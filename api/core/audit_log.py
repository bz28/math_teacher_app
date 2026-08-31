"""FERPA + activity audit-log helpers.

Two related logs:
- `log_student_record_access` — every teacher/admin read of a student
  record. Powers FERPA disclosure-tracking reports.
- `record_activity` — every notable actor write (admin OR teacher):
  deletes/role changes on the admin side, and assignment/generation/
  grade mutations on the teacher side. Powers procurement-required
  admin activity reports and the founder observability hub.

Both helpers are designed to be called from inside route handlers
after authorization has already been confirmed. They add a row to
the caller's existing transaction without flushing or committing, so
the log lives or dies with the surrounding work — if the request
rolls back, the audit entry rolls back too (we don't want to log
work that didn't actually happen).

Helpers never raise: a transient DB error in the audit write must not
break the underlying request. Failures are logged and dropped.
"""

import logging
import uuid
from typing import TYPE_CHECKING, Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity_log import ActivityLog
from api.models.student_record_access_log import StudentRecordAccessLog
from api.models.user import User

if TYPE_CHECKING:
    from api.middleware.auth import CurrentUser
    from api.models.question_bank import QuestionBankItem

logger = logging.getLogger(__name__)


def _client_ip(request: Request | None) -> str | None:
    """Best-effort client IP. Falls back through X-Forwarded-For when
    we're behind a proxy (Railway / Vercel set this) to the direct
    connection address. Truncated to 45 chars for IPv6 column width.
    """
    if request is None:
        return None
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()[:45]
    if request.client and request.client.host:
        return request.client.host[:45]
    return None


def _as_uuid(value: uuid.UUID | str | None) -> uuid.UUID | None:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    return uuid.UUID(str(value))


async def log_student_record_access(
    db: AsyncSession,
    *,
    accessor_user_id: uuid.UUID | str,
    accessor_role: str,
    target_student_id: uuid.UUID | str | None,
    record_type: str,
    record_id: uuid.UUID | str | None = None,
    accessor_school_id: uuid.UUID | str | None = None,
    request: Request | None = None,
) -> None:
    """Record one teacher/admin read of a student record.

    Commits its own row (the calling GET handler has no other write).
    On any failure the row is rolled back and the read proceeds — a
    logging error must not 500 an already-authorized read.
    """
    try:
        entry = StudentRecordAccessLog(
            accessor_user_id=_as_uuid(accessor_user_id),
            accessor_role=accessor_role,
            target_student_id=_as_uuid(target_student_id),
            record_type=record_type,
            record_id=_as_uuid(record_id),
            school_id=_as_uuid(accessor_school_id),
            ip_address=_client_ip(request),
        )
        db.add(entry)
        await db.commit()
    except Exception:
        logger.exception("Failed to log student record access")
        await db.rollback()


async def record_activity(
    db: AsyncSession,
    actor: "CurrentUser",
    action: str,
    target_type: str,
    target_id: uuid.UUID | str | None = None,
    metadata: dict[str, Any] | None = None,
    request: Request | None = None,
) -> None:
    """Record one notable actor action (admin or teacher).

    One best-effort call per mutation, wrapped so a logging failure
    NEVER fails the underlying request. `school_id` is looked up from
    the actor's `users.school_id` at write time (snapshot semantics),
    like LLM-call logging does. Keep `metadata` SMALL — ids / counts /
    titles, never full student content.

    Caller is responsible for committing the surrounding transaction.
    """
    try:
        school_id: uuid.UUID | None = None
        try:
            # Run the lookup inside a SAVEPOINT. A driver-level failure of
            # this SELECT (a DB timeout/outage) leaves the asyncpg
            # transaction in an aborted state that a plain Python `except`
            # can't un-poison — so without the savepoint the caller's later
            # commit() would raise and roll back the teacher's ACTUAL
            # mutation (grade save, publish, etc.). begin_nested() rolls
            # back only to the savepoint, keeping the outer transaction (and
            # the caller's commit) healthy. Best-effort logging must never
            # touch the underlying write.
            async with db.begin_nested():
                school_id = (
                    await db.execute(
                        select(User.school_id).where(User.id == _as_uuid(actor.user_id))
                    )
                ).scalar_one_or_none()
        except Exception:
            logger.warning("activity school lookup failed", exc_info=True)

        entry = ActivityLog(
            actor_user_id=_as_uuid(actor.user_id),
            actor_role=actor.role,
            school_id=school_id,
            action=action,
            target_type=target_type,
            target_id=_as_uuid(target_id),
            action_metadata=metadata,
            ip_address=_client_ip(request),
        )
        db.add(entry)
    except Exception:
        logger.exception("Failed to record activity")


async def record_question_edit(
    db: AsyncSession,
    item: "QuestionBankItem",
    kind: str,
    actor: "CurrentUser | None" = None,
) -> None:
    """Record one teacher edit to a generated question.

    Call AFTER the mutation. `snapshot_history` has already put the old
    question into `previous_question`, so both halves are on the item by
    then and no caller has to carry the before-text around.

    Why a dedicated table rather than `record_activity`: that log is a
    compliance surface with an explicit "keep metadata SMALL — ids /
    counts / titles" contract, and it's read for procurement reporting.
    Question bodies are neither small nor compliance data, and putting
    them there would degrade a surface someone else depends on to serve
    an analysis it was never shaped for.

    Emits ONE ROW PER CHANGED FIELD, because a bank item is the output
    of two different LLM calls: the question comes from
    `generate_questions`, the solution and final answer from `decompose`.
    A single PATCH that rewrites both is evidence against both prompts
    and must not collapse into one row.

    Records nothing for a field that didn't actually change — a teacher
    fixing a typo in the TITLE is not evidence about any prompt, and
    counting it would dilute the signal the admin pages exist to
    surface. A request that changed no tracked field records nothing at
    all.

    Never raises: the edit already happened, and failing to log it must
    not fail the teacher's request.
    """
    from api.models.question_edit import (
        FIELD_FINAL_ANSWER,
        FIELD_QUESTION,
        FIELD_SOLUTION,
        REJECT,
        QuestionEdit,
    )

    try:
        # (field, before, after) for every tracked field. `snapshot_history`
        # has already written each previous_* value, so both halves are on
        # the item and no caller carries them around.
        pairs: list[tuple[str, str | None, str | None]] = [
            (FIELD_QUESTION, item.previous_question, item.question),
            (
                FIELD_SOLUTION,
                _steps_text(item.previous_solution_steps),
                _steps_text(item.solution_steps),
            ),
            (FIELD_FINAL_ANSWER, item.previous_final_answer, item.final_answer),
            # Distractors are deliberately absent: `snapshot_history` has
            # no `previous_distractors`, so there is no before-value to
            # diff against. Treating a missing snapshot as "changed"
            # would mint a spurious row on every edit of any MCQ item.
            # Tracking them means extending the teacher-facing one-level
            # undo, which is a separate change.
        ]

        if kind == REJECT:
            # Nothing changed — the teacher binned the question as written.
            # Record the rejected text with no replacement, so the drill-in
            # can still show what was thrown out.
            changed: list[tuple[str, str | None, str | None]] = [
                (FIELD_QUESTION, item.question, None)
            ]
        else:
            changed = [(f, b, a) for f, b, a in pairs if b != a]

        if not changed:
            return

        school_id: uuid.UUID | None = None
        actor_id: uuid.UUID | None = None
        if actor is not None:
            actor_id = _as_uuid(actor.user_id)
            try:
                async with db.begin_nested():
                    school_id = (await db.execute(
                        select(User.school_id).where(User.id == actor_id)
                    )).scalar_one_or_none()
            except Exception:  # noqa: BLE001 — same savepoint guard record_activity uses
                logger.exception("question-edit school lookup failed")

        for field, before, after in changed:
            db.add(QuestionEdit(
                bank_item_id=item.id,
                edited_by_id=actor_id,
                school_id=school_id,
                kind=kind,
                field=field,
                before=before,
                after=after,
            ))
    except Exception:  # noqa: BLE001
        logger.exception("could not record question edit for item %s", item.id)


def _steps_text(steps: Any) -> str | None:
    """Flatten solution steps to the text a human reads when debugging.

    Stored as text rather than JSON because the only consumer is the
    admin drill-in's before/after diff — nothing re-parses it, and prose
    diffs far more legibly than a re-serialized object whose key order
    could change the string without the solution changing at all.
    """
    if not steps:
        return None
    if not isinstance(steps, list):
        return str(steps)
    parts: list[str] = []
    for i, s in enumerate(steps, start=1):
        if isinstance(s, dict):
            title = str(s.get("title") or "").strip()
            body = str(s.get("description") or "").strip()
            head = f"{i}. {title}" if title else f"{i}."
            parts.append(f"{head}\n{body}".strip())
        else:
            parts.append(f"{i}. {s}")
    return "\n\n".join(parts) or None
