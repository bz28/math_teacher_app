"""Shared bank ↔ assignment service helpers.

These helpers used to live inside ``api/routes/teacher_assignments.py``
which forced ``teacher_question_bank.py`` to import from another route
file just to reach them. Routes shouldn't import from routes — moving
the helpers here gives both routes a clean dependency on the service
layer instead.

Everything in this module is async + side-effect free at the orchestration
level (mutations are scoped to the SQLAlchemy session passed in).
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.assignment import Assignment
from api.models.question_bank import QuestionBankItem

logger = logging.getLogger(__name__)


async def snapshot_bank_items(
    db: AsyncSession,
    course_id: uuid.UUID,
    bank_item_ids: list[uuid.UUID],
) -> dict[str, Any]:
    """Validate the bank items belong to the course and are approved, then
    return a content dict that *references* them by id. The actual
    question text is JOINed in at read time so edits to the bank
    propagate live (the bank is the single source of truth).

    Stored shape:
        { "problem_ids": ["uuid1", "uuid2", ...] }
    """
    if not bank_item_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one question is required",
        )

    rows = (await db.execute(
        select(QuestionBankItem.id).where(
            QuestionBankItem.id.in_(bank_item_ids),
            QuestionBankItem.course_id == course_id,
            QuestionBankItem.status == "approved",
        )
    )).scalars().all()

    found = set(rows)
    missing = [str(i) for i in bank_item_ids if i not in found]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Some questions aren't approved or don't belong to this course: {missing}"
            ),
        )

    return {"problem_ids": [str(b) for b in bank_item_ids]}


async def hydrate_assignment_content(
    db: AsyncSession, assignment: Assignment,
) -> dict[str, Any] | None:
    """Read assignment.content and return it with live `problems` joined
    from the bank. Backwards-compat fallback: if content is the legacy
    snapshot shape (`problems` with question text), return it as-is."""
    content = assignment.content
    if not isinstance(content, dict):
        return content
    # Legacy: pre-refactor snapshots stored full problem objects.
    if "problems" in content and "problem_ids" not in content:
        return content
    ids = content.get("problem_ids") or []
    if not ids:
        return {"problems": []}
    # Defensive: skip junk IDs rather than 500 the whole assignment view.
    # Log a warning so corruption is visible in monitoring instead of
    # silently masked behind a working UI.
    uuid_ids: list[uuid.UUID] = []
    for i in ids:
        try:
            uuid_ids.append(i if isinstance(i, uuid.UUID) else uuid.UUID(str(i)))
        except (ValueError, TypeError):
            logger.warning(
                "hydrate_assignment_content: dropping invalid UUID %r in assignment %s.content",
                i, assignment.id,
            )
            continue
    if not uuid_ids:
        return {"problems": []}
    rows = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id.in_(uuid_ids))
    )).scalars().all()
    by_id = {str(r.id): r for r in rows}
    problems = []
    for position, bid in enumerate(ids, start=1):
        item = by_id.get(str(bid))
        if not item:
            continue  # silently drop missing/deleted refs
        problems.append({
            "bank_item_id": str(item.id),
            "position": position,
            "question": item.question,
            "solution_steps": item.solution_steps,
            "final_answer": item.final_answer,
            "difficulty": item.difficulty,
        })
    return {"problems": problems}


def problem_ids_in_content(content: Any) -> list[str]:
    """Extract bank item IDs from an assignment content dict, handling
    both the new and legacy shapes."""
    if not isinstance(content, dict):
        return []
    if "problem_ids" in content and isinstance(content["problem_ids"], list):
        return [str(i) for i in content["problem_ids"]]
    if "problems" in content and isinstance(content["problems"], list):
        return [str(p.get("bank_item_id")) for p in content["problems"] if p.get("bank_item_id")]
    return []


async def used_in_assignments_map(
    db: AsyncSession, course_id: uuid.UUID,
) -> dict[str, list[dict[str, Any]]]:
    """For every assignment in the course (draft + published), return a
    map of bank_item_id → list of {id, title, type, status, unit_ids}
    entries. The unit_ids field lets the question bank UI group its
    Approved view by HW's units without a separate fetch.

    Drafts are included so the teacher sees their in-progress homework
    references; only published entries actually lock the bank item
    (see recompute_bank_locks)."""
    rows = (await db.execute(
        select(Assignment).where(Assignment.course_id == course_id)
    )).scalars().all()
    out: dict[str, list[dict[str, Any]]] = {}
    for a in rows:
        entry = {
            "id": str(a.id),
            "title": a.title,
            "type": a.type,
            "status": a.status,
            "unit_ids": [str(u) for u in (a.unit_ids or [])],
        }
        for pid in problem_ids_in_content(a.content):
            out.setdefault(pid, []).append(entry)
    return out


async def recompute_bank_locks(db: AsyncSession, course_id: uuid.UUID) -> None:
    """Recalculate `locked` for every bank item in a course based on
    whether any published assignment references it. Cheap enough — runs
    only on publish/unpublish."""
    used = await used_in_assignments_map(db, course_id)
    # Only published references lock the bank item; drafts can be edited freely.
    locked_ids = {
        pid for pid, refs in used.items()
        if any(r.get("status") == "published" for r in refs)
    }
    items = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.course_id == course_id)
    )).scalars().all()
    for item in items:
        should_lock = str(item.id) in locked_ids
        if item.locked != should_lock:
            item.locked = should_lock


async def used_in_for_item(
    db: AsyncSession, item: QuestionBankItem,
) -> list[dict[str, Any]]:
    """Look up the assignments referencing this single bank item.
    Used by per-item endpoints so the response stays consistent with
    the list endpoint instead of returning a stale-empty `used_in`."""
    used = await used_in_assignments_map(db, item.course_id)
    return used.get(str(item.id), [])
