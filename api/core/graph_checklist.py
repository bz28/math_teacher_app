"""A graph question's checklist: when it is written, and how it is read.

A question that requires a drawing gets a checklist of the features a
correct graph must show (`drawing_check.write_graph_checklist`), written
from the final question and answer key when the teacher approves it. It
is written again when "requires a drawing" is switched on for an approved
question that has none, and when the question text or the answer key
changes — unless the teacher has edited it, which makes it hers: only her
"write it again from the answer key" replaces it. Switching the drawing
requirement off keeps the checklist (it is just not used).

A checklist records what it was written from (`source`, a hash of the
question and answer key). One the teacher hasn't edited whose source no
longer matches the question is stale: it reads as not written
(`current_checklist`) and the next write replaces it. Deciding staleness
from the stored row, not from what a save saw, is what makes it hold
when a background write commits between a save loading the row and
committing it, or a second tab saves new text.

The write runs after the save, in the background (`schedule_write`). It
is one Sonnet call of a few seconds, the teacher who clicked Approve
isn't waiting for it, and a failure must never fail the approval: it
leaves the checklist unwritten. Before saving, the write re-reads the row
under a lock and saves only if the question is still the one it wrote
from, so a teacher's edit made while the model ran always wins.

Points are stored as written, with the problem's points at that time,
and resolved on read for the rules the grader applies to the homework
(class rules it hasn't skipped) and the problem's current points
(`checklist_points.fit_checklist`).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from dataclasses import asdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.checklist_points import fit_checklist, link_rules
from api.core.class_rubric import effective_rubric
from api.core.constants import SOLUTION_FAILED_SENTINEL_PREFIX
from api.core.drawing_check import ChecklistItem, write_graph_checklist
from api.core.homework_points import assignment_points
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.services.bank import problem_ids_in_content

logger = logging.getLogger(__name__)

_BACKGROUND_TASKS: set[asyncio.Task[None]] = set()
# (item id, source) of every write in flight, so a second save of the
# same text while the model runs doesn't pay for a second call.
_IN_FLIGHT: set[tuple[uuid.UUID, str]] = set()


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


def source_of(item: QuestionBankItem) -> str:
    """What a checklist is written from: the question and answer key."""
    text = f"{item.question or ''}\x00{item.final_answer or ''}"
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def current_checklist(item: QuestionBankItem) -> dict[str, Any] | None:
    """The stored checklist, unless it is stale: not edited by the
    teacher, and written from a question or answer key that has since
    changed."""
    stored = item.graph_checklist
    if not stored:
        return None
    if stored.get("teacher_edited") or stored.get("source") == source_of(item):
        return stored
    return None


def due(item: QuestionBankItem) -> bool:
    """Call after a save, before its commit: True when a checklist should
    be written once it commits (`schedule_write`)."""
    return needs_checklist(item) and current_checklist(item) is None


def stored_items(stored: dict[str, Any] | None) -> list[ChecklistItem]:
    return [
        ChecklistItem(
            text=str(i["text"]), points=int(i["points"]), rule_id=i.get("rule_id"),
            values_to_check=list(i.get("values_to_check") or []),
        )
        for i in (stored or {}).get("items") or []
    ]


def to_stored(
    items: list[ChecklistItem], points: int, *, source: str, teacher_edited: bool,
    asks_for_drawing: bool = True,
) -> dict[str, Any]:
    """`asks_for_drawing` False: the writer read the question as asking
    for no drawing, so it has no items. Stored like any checklist, so it
    isn't written again until the question or answer key changes."""
    stored: dict[str, Any] = {
        "items": [asdict(i) for i in items], "points": points,
        "source": source, "teacher_edited": teacher_edited,
    }
    if not asks_for_drawing:
        stored["asks_for_drawing"] = False
    return stored


def grading_rules(course: Course | None, assignment: Assignment | None) -> list[dict[str, Any]]:
    """The class rules the grader applies to this homework: the class's,
    minus any the homework skips."""
    rubric = effective_rubric(
        course.rubric if course else None, assignment.rubric if assignment else None,
    )
    return list((rubric or {}).get("rules") or [])


def checklist_view(
    item: QuestionBankItem, problem_points: int | None, rules: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """The checklist as the teacher sees it: points resolved for the
    homework's rules and the problem's current points. Without problem
    points (the question isn't on its homework), rule links are still
    checked but nothing is re-sized."""
    stored = current_checklist(item)
    if not stored:
        return None
    items = stored_items(stored)
    if problem_points:
        items = fit_checklist(items, int(stored.get("points") or problem_points), problem_points, rules)
    else:
        items = link_rules(items, rules)
    by_id = {r["id"]: r for r in rules}

    def rule_points(rule_id: str | None) -> int | None:
        p = (by_id.get(rule_id) or {}).get("points") if rule_id else None
        return p if isinstance(p, int) and p > 0 else None

    return {
        # `rule_text`: the linked rule's wording, for "from class rule · …".
        # `rule_points`: what the rule makes the item worth when it sets
        # points (the editor counts it so, as the save checks it); None
        # when the item keeps its own points.
        "items": [
            {**asdict(i), "rule_text": (by_id.get(i.rule_id) or {}).get("text"),
             "rule_points": rule_points(i.rule_id)}
            for i in items
        ],
        "graph_points": sum(i.points for i in items),
        "problem_points": problem_points,
        "teacher_edited": bool(stored.get("teacher_edited")),
        "asks_for_drawing": stored.get("asks_for_drawing", True) is not False,
    }


async def homework_context(
    db: AsyncSession, item: QuestionBankItem,
) -> tuple[int | None, list[dict[str, Any]]]:
    """What `item` is worth on its homework (None when it isn't on it: a
    variation, or approved after the homework was published), and the
    rules the grader applies there."""
    assignment = await db.get(Assignment, item.originating_assignment_id)
    course = await db.get(Course, item.course_id)
    points = assignment_points(assignment).get(str(item.id)) if assignment else None
    return points, grading_rules(course, assignment)


async def checklist_views(
    db: AsyncSession, items: list[QuestionBankItem],
) -> dict[uuid.UUID, dict[str, Any] | None]:
    """`checklist_view` for many items, loading each homework and class
    once."""
    with_checklist = [i for i in items if current_checklist(i)]
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
        assignment = assignments.get(i.originating_assignment_id)
        out[i.id] = checklist_view(
            i,
            points.get(i.originating_assignment_id, {}).get(str(i.id)),
            grading_rules(courses.get(i.course_id), assignment),
        )
    return out


async def homework_checklists(db: AsyncSession, assignment: Assignment) -> dict[str, dict[str, Any]]:
    """For the homework page: every problem on `assignment` that requires
    a drawing, with its checklist as this homework grades it (the
    problem's points here, the rules the homework applies). `checklist`
    None = not written yet; `can_write` False = it can't have one (no
    answer key yet)."""
    if assignment.type == "practice":
        return {}
    ids = []
    for pid in problem_ids_in_content(assignment.content):
        try:
            ids.append(uuid.UUID(pid))
        except ValueError:
            continue
    if not ids:
        return {}
    items = (await db.execute(
        select(QuestionBankItem).where(
            QuestionBankItem.id.in_(ids), QuestionBankItem.requires_drawing.is_(True),
        )
    )).scalars().all()
    if not items:
        return {}
    rules = grading_rules(await db.get(Course, assignment.course_id), assignment)
    points = assignment_points(assignment)
    return {
        str(i.id): {
            "checklist": checklist_view(i, points.get(str(i.id)), rules),
            "can_write": needs_checklist(i),
        }
        for i in items
    }


async def write_checklist(
    db: AsyncSession, item_id: uuid.UUID, *, user_id: str | None, replace_teacher_edit: bool = False,
) -> bool:
    """Write `item_id`'s checklist from its question and answer key, and
    commit. Returns True when one was saved.

    Writes only when there is no current checklist (none, or a stale
    one), unless `replace_teacher_edit` (the teacher asked for it to be
    written again). No read transaction is held across the model call.
    Afterwards the row is re-read under a lock and the checklist saved
    only if the question and answer key are still the ones it was written
    from and the item still needs one; otherwise the newer save's own
    write takes over."""
    item = await db.get(QuestionBankItem, item_id)
    if item is None or not needs_checklist(item):
        return False
    if current_checklist(item) is not None and not replace_teacher_edit:
        return False
    source = source_of(item)
    question, answer = item.question, item.final_answer
    points, rules = await homework_context(db, item)
    await db.rollback()
    if not points:
        return False
    written = await write_graph_checklist(question, answer, points, class_rules=rules, user_id=user_id)
    if not written.items and written.asks_for_drawing:
        return False
    locked = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id == item_id)
        .with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if (
        locked is None
        or not needs_checklist(locked)
        or source_of(locked) != source
        or (current_checklist(locked) is not None and not replace_teacher_edit)
    ):
        await db.rollback()
        return False
    locked.graph_checklist = to_stored(
        written.items, points, source=source, teacher_edited=False,
        asks_for_drawing=written.asks_for_drawing,
    )
    await db.commit()
    return True


async def _write_in_background(item_id: uuid.UUID, key: tuple[uuid.UUID, str], user_id: str | None) -> None:
    try:
        async with get_session_factory()() as db:
            await write_checklist(db, item_id, user_id=user_id)
    except Exception:
        # The checklist stays unwritten; the save that asked for it has
        # already committed.
        logger.exception("graph checklist write failed for bank item %s", item_id)
    finally:
        _IN_FLIGHT.discard(key)


def schedule_write(item: QuestionBankItem, *, user_id: str | None) -> None:
    """Write `item`'s missing checklist after the current request, in its
    own session. Call after the save that needs it has committed. A write
    already in flight for the same question and answer key covers it."""
    key = (item.id, source_of(item))
    if key in _IN_FLIGHT:
        return
    _IN_FLIGHT.add(key)
    task = asyncio.get_running_loop().create_task(_write_in_background(item.id, key, user_id))
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)


async def drain_checklist_tasks() -> None:
    """Test helper: wait for every scheduled checklist write."""
    while _BACKGROUND_TASKS:
        await asyncio.gather(*list(_BACKGROUND_TASKS), return_exceptions=True)
