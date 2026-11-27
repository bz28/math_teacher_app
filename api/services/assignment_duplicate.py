"""Making new assignments from a homework's problems: the bank items a
homework holds, in order, and the generation jobs that write practice
versions of them."""

import copy
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.assignment import Assignment, AssignmentSection
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.section import Section
from api.models.unit import Unit
from api.services.bank import problem_ids_in_content


async def homework_bank_items(
    db: AsyncSession, course_id: uuid.UUID, source: Assignment, item_ids: list[uuid.UUID] | None,
) -> list[QuestionBankItem]:
    """The homework's bank items to write versions of, in homework order.
    A requested id that isn't on the homework is a 400, never a silent skip."""
    on_hw: list[uuid.UUID] = []
    for raw in problem_ids_in_content(source.content):
        try:
            on_hw.append(uuid.UUID(raw))
        except (ValueError, TypeError):
            continue  # corrupted content: skip rather than 500
    if item_ids is not None:
        unknown = set(item_ids) - set(on_hw)
        if unknown or not item_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Pick problems from this homework",
            )
        on_hw = [i for i in on_hw if i in set(item_ids)]
    if not on_hw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source homework has no problems to clone",
        )
    # The course filter is defense in depth against rows that escaped
    # snapshot_bank_items' approved+primary+course invariant.
    items = (await db.execute(
        select(QuestionBankItem).where(
            QuestionBankItem.id.in_(on_hw),
            QuestionBankItem.course_id == course_id,
        )
    )).scalars().all()
    by_id = {i.id: i for i in items}
    # An item deleted since the content snapshot is skipped; the teacher
    # can add it again later.
    return [by_id[i] for i in on_hw if i in by_id]


def queue_variation_jobs(
    db: AsyncSession, practice: Assignment, parents: list[QuestionBankItem], count: int, teacher_id: uuid.UUID,
) -> list[uuid.UUID]:
    """One generation job per parent writing `count` versions of it into
    `practice` via the `parent_question_id` path. Items land pending in
    the teacher's review queue. The id is set at construction: the
    model default only fires on flush, and `schedule_generation_job(None)`
    once silently ran nothing."""
    job_ids: list[uuid.UUID] = []
    for parent in parents:
        job_id = uuid.uuid4()
        db.add(QuestionBankGenerationJob(
            id=job_id,
            course_id=practice.course_id,
            unit_id=parent.unit_id,
            originating_assignment_id=practice.id,
            created_by_id=teacher_id,
            status="queued",
            requested_count=count,
            difficulty=parent.difficulty,
            source_doc_ids=parent.source_doc_ids,
            parent_question_id=parent.id,
        ))
        job_ids.append(job_id)
    return job_ids


# What a question *is*, copied when a homework goes to another course.
# Not copied: who/where (course, unit, homework, author), review state
# (always approved: it was approved where it came from), the lock, the
# undo history, the Workshop chat, variations, and source documents
# (they belong to the other course).
_QUESTION_FIELDS = (
    "title", "question", "solution_steps", "final_answer", "distractors",
    "difficulty", "format", "figure_spec", "figure_svg", "figure_facts",
    "requires_drawing", "requires_drawing_teacher_set", "graph_checklist",
    "source", "generation_prompt",
)


async def _target_unit_ids(
    db: AsyncSession, source_unit_ids: list[uuid.UUID], target_course_id: uuid.UUID,
) -> dict[uuid.UUID, uuid.UUID]:
    """Map each source unit (or subfolder) to the target course's top-level
    unit of the same name as its top-level unit, creating that unit when the
    target has none. Names match case- and space-insensitively."""
    if not source_unit_ids:
        return {}
    src = {u.id: u for u in (await db.execute(
        select(Unit).where(Unit.id.in_(set(source_unit_ids)))
    )).scalars().all()}
    parent_ids = {u.parent_unit_id for u in src.values() if u.parent_unit_id} - set(src)
    if parent_ids:
        for u in (await db.execute(select(Unit).where(Unit.id.in_(parent_ids)))).scalars().all():
            src[u.id] = u
    targets = (await db.execute(
        select(Unit).where(Unit.course_id == target_course_id, Unit.parent_unit_id.is_(None))
        .order_by(Unit.position)
    )).scalars().all()

    def key(name: str) -> str:
        return " ".join(name.split()).casefold()

    by_name = {key(u.name): u.id for u in targets}
    next_position = max((u.position for u in targets), default=-1) + 1
    out: dict[uuid.UUID, uuid.UUID] = {}
    for uid in source_unit_ids:
        unit = src.get(uid)
        if unit is None:
            continue
        top = src.get(unit.parent_unit_id, unit) if unit.parent_unit_id else unit
        k = key(top.name)
        if k not in by_name:
            created = Unit(
                id=uuid.uuid4(), course_id=target_course_id,
                name=top.name, position=next_position,
            )
            db.add(created)
            by_name[k] = created.id
            next_position += 1
        out[uid] = by_name[k]
    # No ORM relationship orders these before the questions that use them.
    await db.flush()
    return out


async def duplicate_homework(
    db: AsyncSession,
    source: Assignment,
    *,
    target_course_id: uuid.UUID,
    teacher_id: uuid.UUID,
    due_at: datetime | None,
    section_ids: list[uuid.UUID],
) -> Assignment:
    """A new draft homework with the source's problems, grading rules,
    points, late policy and instructions, due when and for whom the
    teacher picked (never the source's own date or sections).

    In the same course the copy points at the same bank questions, as
    every homework does. In another course each question is copied into
    that course, approved (it was approved where it came from), and the
    copy remembers its source homework in `source_homework_id`. The
    caller checks the teacher owns the source and the target course."""
    cross_course = target_course_id != source.course_id
    problem_ids = problem_ids_in_content(source.content)
    if cross_course and source.content and not problem_ids:
        # A legacy inline-snapshot homework has no bank questions to copy.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This homework is too old to copy into another course",
        )

    if section_ids:
        found = set((await db.execute(
            select(Section.id).where(
                Section.id.in_(section_ids), Section.course_id == target_course_id,
            )
        )).scalars().all())
        if len(found) != len(set(section_ids)):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more sections do not belong to this course",
            )

    rubric = copy.deepcopy(source.rubric)
    if cross_course and isinstance(rubric, dict):
        # Skipped class rules are the other course's rules.
        rubric.pop("skipped_rule_ids", None)
    copy_ = Assignment(
        id=uuid.uuid4(),
        course_id=target_course_id,
        teacher_id=teacher_id,
        title=source.title,
        description=source.description,
        type="homework",
        source_type=source.source_type,
        source_homework_id=source.id if cross_course else None,
        status="draft",
        due_at=due_at,
        late_policy=source.late_policy,
        content=copy.deepcopy(source.content),
        answer_key=copy.deepcopy(source.answer_key),
        document_ids=None if cross_course else copy.deepcopy(source.document_ids),
        integrity_check_enabled=source.integrity_check_enabled,
        ai_grading_enabled=source.ai_grading_enabled,
        rubric=rubric,
        total_points=source.total_points,
        problem_points=copy.deepcopy(source.problem_points),
        unit_ids=list(source.unit_ids or []),
    )

    if cross_course:
        valid_ids: list[uuid.UUID] = []
        for raw in problem_ids:
            try:
                valid_ids.append(uuid.UUID(raw))
            except (ValueError, TypeError):
                continue  # corrupted content: skip rather than 500
        items = {str(i.id): i for i in (await db.execute(
            select(QuestionBankItem).where(
                QuestionBankItem.id.in_(valid_ids),
                QuestionBankItem.course_id == source.course_id,
            )
        )).scalars().all()}
        unit_map = await _target_unit_ids(
            db,
            list(dict.fromkeys([*copy_.unit_ids, *(i.unit_id for i in items.values())])),
            target_course_id,
        )
        copy_.unit_ids = list(dict.fromkeys(unit_map[u] for u in copy_.unit_ids if u in unit_map))
        if not copy_.unit_ids and unit_map:
            copy_.unit_ids = [next(iter(unit_map.values()))]
        new_ids: dict[str, str] = {}
        for pid in problem_ids:
            item = items.get(pid)
            if item is None:
                continue  # deleted since; the copy simply doesn't have it
            new = QuestionBankItem(
                id=uuid.uuid4(),
                course_id=target_course_id,
                unit_id=unit_map[item.unit_id],
                originating_assignment_id=copy_.id,
                status="approved",
                created_by_id=teacher_id,
                **{f: copy.deepcopy(getattr(item, f)) for f in _QUESTION_FIELDS},
            )
            db.add(new)
            new_ids[pid] = str(new.id)
        copy_.content = {"problem_ids": list(new_ids.values())}
        if isinstance(copy_.problem_points, dict):
            copy_.problem_points = {
                new_ids[p]: pts for p, pts in copy_.problem_points.items() if p in new_ids
            } or None
        copy_.answer_key = None  # keyed by the other course's problems

    if not copy_.unit_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This homework has no unit to copy",
        )
    db.add(copy_)
    await db.flush()
    # Stamped now, as the sections endpoint does for a draft: publish only
    # fills the rows it fans out itself.
    now = datetime.now(UTC)
    for sid in dict.fromkeys(section_ids):
        db.add(AssignmentSection(assignment_id=copy_.id, section_id=sid, published_at=now))
    return copy_
