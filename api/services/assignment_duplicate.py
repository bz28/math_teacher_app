"""Making new assignments from a homework's problems: the bank items a
homework holds, in order, and the generation jobs that write practice
versions of them."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.assignment import Assignment
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
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
