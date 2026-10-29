"""A graph question's checklist: when it is written, and how it is read.

A question that requires a drawing gets a checklist of the features a
correct graph must show (`drawing_check.write_graph_checklist`), written
from the final question and answer key when the teacher approves it. It
is written again when "requires a drawing" is switched on for an approved
question that has none, and when the question text or the answer key
changes — unless the teacher has edited it, which makes it hers: only her
"write it again from the answer key" replaces it. Switching the drawing
requirement off keeps the checklist (it is just not used).

The write runs after the save, in the background (`schedule_write`). It
is one Sonnet call of a few seconds, the teacher who clicked Approve
isn't waiting for it, and a failure must never fail the approval: it
leaves the checklist unwritten. A save that makes a stored checklist
stale clears it in the same transaction (`after_save`), so a checklist
is never read against a question it wasn't written for. The background
write re-checks the question under a row lock before saving, so a
teacher's edit (to the question or the checklist) made while the model
ran always wins.

Points are stored as written, with the problem's points at that time,
and resolved on read for the class's current rules and the problem's
current points (`checklist_points.fit_checklist`).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import asdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.checklist_points import fit_checklist
from api.core.class_rubric import class_rules
from api.core.constants import SOLUTION_FAILED_SENTINEL_PREFIX
from api.core.drawing_check import ChecklistItem, write_graph_checklist
from api.core.homework_points import assignment_points
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.question_bank import QuestionBankItem

logger = logging.getLogger(__name__)

_BACKGROUND_TASKS: set[asyncio.Task[None]] = set()


def needs_checklist(item: QuestionBankItem) -> bool:
    """An approved homework problem that asks for a drawing and has a
    real answer key to write the checklist from. Variations are practice
    scaffolding, never graded on a homework, so they get none."""
    answer = (item.final_answer or "").strip()
    return (
        item.status == "approved"
        and bool(item.requires_drawing)
        and item.parent_question_id is None
        and bool(answer)
        and not answer.startswith(SOLUTION_FAILED_SENTINEL_PREFIX)
    )


def checklist_source(item: QuestionBankItem) -> tuple[str, str]:
    """What a checklist is written from. Read before a save, handed to
    `after_save` after it."""
    return (item.question or "", item.final_answer or "")


def after_save(item: QuestionBankItem, source_before: tuple[str, str]) -> bool:
    """Call after a save has changed `item`, before its commit. Clears a
    checklist the save made stale (the question or answer key changed and
    the teacher never edited it). Returns True when a checklist should be
    written once the save commits (`schedule_write`)."""
    stored = item.graph_checklist
    if stored and not stored.get("teacher_edited") and checklist_source(item) != source_before:
        item.graph_checklist = None
    return needs_checklist(item) and item.graph_checklist is None


def stored_items(stored: dict[str, Any] | None) -> list[ChecklistItem]:
    return [
        ChecklistItem(text=str(i["text"]), points=int(i["points"]), rule_id=i.get("rule_id"))
        for i in (stored or {}).get("items") or []
    ]


def to_stored(items: list[ChecklistItem], points: int, *, teacher_edited: bool) -> dict[str, Any]:
    return {"items": [asdict(i) for i in items], "points": points, "teacher_edited": teacher_edited}


def checklist_view(
    item: QuestionBankItem, problem_points: int | None, rules: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """The checklist as the teacher sees it: points resolved for the
    class's current rules and the problem's current points. Without
    problem points (the question isn't on its homework), as stored."""
    stored = item.graph_checklist
    if not stored:
        return None
    items = stored_items(stored)
    if problem_points:
        items = fit_checklist(items, int(stored.get("points") or problem_points), problem_points, rules)
    return {
        "items": [asdict(i) for i in items],
        "graph_points": sum(i.points for i in items),
        "problem_points": problem_points,
        "teacher_edited": bool(stored.get("teacher_edited")),
    }


async def problem_points(db: AsyncSession, item: QuestionBankItem) -> int | None:
    """What `item` is worth on its homework; None when it isn't on it
    (a variation, or approved after the homework was published)."""
    assignment = await db.get(Assignment, item.originating_assignment_id)
    return assignment_points(assignment).get(str(item.id)) if assignment else None


async def checklist_views(
    db: AsyncSession, items: list[QuestionBankItem],
) -> dict[uuid.UUID, dict[str, Any] | None]:
    """`checklist_view` for many items, loading each homework and class
    once."""
    with_checklist = [i for i in items if i.graph_checklist]
    if not with_checklist:
        return {}
    assignments = {
        a.id: a for a in (await db.execute(
            select(Assignment).where(Assignment.id.in_({i.originating_assignment_id for i in with_checklist}))
        )).scalars()
    }
    courses = {
        c.id: c for c in (await db.execute(
            select(Course).where(Course.id.in_({i.course_id for i in with_checklist}))
        )).scalars()
    }
    points = {aid: assignment_points(a) for aid, a in assignments.items()}
    out: dict[uuid.UUID, dict[str, Any] | None] = {}
    for i in with_checklist:
        course = courses.get(i.course_id)
        out[i.id] = checklist_view(
            i,
            points.get(i.originating_assignment_id, {}).get(str(i.id)),
            class_rules(course.rubric if course else None),
        )
    return out


async def write_checklist(
    db: AsyncSession, item_id: uuid.UUID, *, user_id: str | None, replace_teacher_edit: bool = False,
) -> bool:
    """Write `item_id`'s checklist from its question and answer key, and
    commit. Returns True when one was saved.

    Writes only a missing checklist, unless `replace_teacher_edit` (the
    teacher asked for it to be written again). No read transaction is held
    across the model call. Afterwards the row is re-read under a lock and
    the checklist saved only if the question and answer key are still the
    ones it was written from and the item still needs one; otherwise the
    newer save's own write takes over."""
    item = await db.get(QuestionBankItem, item_id)
    if item is None or not needs_checklist(item):
        return False
    if item.graph_checklist is not None and not replace_teacher_edit:
        return False
    source = checklist_source(item)
    points = await problem_points(db, item)
    course = await db.get(Course, item.course_id)
    rules = class_rules(course.rubric if course else None)
    await db.rollback()
    if not points:
        return False
    items = await write_graph_checklist(source[0], source[1], points, class_rules=rules, user_id=user_id)
    if not items:
        return False
    locked = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id == item_id)
        .with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if (
        locked is None
        or not needs_checklist(locked)
        or checklist_source(locked) != source
        or (locked.graph_checklist is not None and not replace_teacher_edit)
    ):
        await db.rollback()
        return False
    locked.graph_checklist = to_stored(items, points, teacher_edited=False)
    await db.commit()
    return True


async def _write_in_background(item_id: uuid.UUID, user_id: str | None) -> None:
    try:
        async with get_session_factory()() as db:
            await write_checklist(db, item_id, user_id=user_id)
    except Exception:
        # The checklist stays unwritten; the save that asked for it has
        # already committed.
        logger.exception("graph checklist write failed for bank item %s", item_id)


def schedule_write(item_id: uuid.UUID, *, user_id: str | None) -> None:
    """Write `item_id`'s missing checklist after the current request, in
    its own session. Call after the save that needs it has committed."""
    task = asyncio.get_running_loop().create_task(_write_in_background(item_id, user_id))
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)


async def drain_checklist_tasks() -> None:
    """Test helper: wait for every scheduled checklist write."""
    while _BACKGROUND_TASKS:
        await asyncio.gather(*list(_BACKGROUND_TASKS), return_exceptions=True)
