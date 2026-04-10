"""Integrity-checker pipeline orchestrator + shared constants.

The single entry point is `start_integrity_check(submission_id, db)`,
called from `submit_homework` immediately after the submission row
is committed. The pipeline:

1. Loads the submission + assignment.
2. Bails if integrity_check_enabled is false (no rows created).
3. Picks the first N (cap MAX_SAMPLE) primary problems from
   `assignment.content`. The order is deterministic so a student
   resuming gets the same set.
4. For each picked problem: calls the (stubbed) extraction +
   question generation, inserts an IntegrityCheckProblem row at
   status `awaiting_student`, and one IntegrityCheckResponse row
   per generated question.

The function is `async def` and takes an `AsyncSession` so PR 4 can
swap the stubs for real Vision/Sonnet calls without changing call
sites. Errors raised inside the pipeline propagate to the caller —
the submit endpoint wraps the whole call in try/except so a
pipeline failure can never block the kid's submission.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.integrity_ai import (
    extract_student_work,
    generate_questions,
)
from api.models.assignment import Assignment, Submission
from api.models.integrity_check import IntegrityCheckProblem, IntegrityCheckResponse
from api.models.question_bank import QuestionBankItem
from api.services.bank import problem_ids_in_content

logger = logging.getLogger(__name__)

MAX_SAMPLE = 5

# Per-problem status state machine. Centralized so a typo anywhere
# in the codebase fails at import time, not silently at runtime.
STATUS_PENDING = "pending"
STATUS_GENERATING = "generating"
STATUS_AWAITING_STUDENT = "awaiting_student"
STATUS_SCORING = "scoring"
STATUS_COMPLETE = "complete"
STATUS_DISMISSED = "dismissed"
STATUS_SKIPPED_UNREADABLE = "skipped_unreadable"

# "Done" set: a problem in any of these states does NOT contribute
# to in_progress and is skipped by the next-question walker.
TERMINAL_STATUSES = frozenset({
    STATUS_COMPLETE,
    STATUS_DISMISSED,
    STATUS_SKIPPED_UNREADABLE,
})

# Verdicts the scorer can emit. Stub uses good/weak/bad; PR 4 will
# add skipped + rephrased.
VERDICT_GOOD = "good"
VERDICT_WEAK = "weak"
VERDICT_BAD = "bad"
VERDICT_SKIPPED = "skipped"
VERDICT_REPHRASED = "rephrased"

# Badge values surfaced to the teacher.
BADGE_LIKELY = "likely"
BADGE_UNCERTAIN = "uncertain"
BADGE_UNLIKELY = "unlikely"
BADGE_UNREADABLE = "unreadable"


def compute_badge(verdicts: list[str], flags: list[str]) -> tuple[str, float]:
    """Map a set of per-question verdicts + flags onto a per-problem
    badge + raw score (0..1).

    Per the parent plan §6:
    - score >= 0.75 + no hard flags → likely
    - score >= 0.40             → uncertain
    - score < 0.40 OR hard flag → unlikely

    Empty verdicts (defensive) → uncertain. False reds are more
    damaging than false greens, so we lean conservative on the
    boundaries.
    """
    if not verdicts:
        return (BADGE_UNCERTAIN, 0.0)

    weights = {
        VERDICT_GOOD: 1.0,
        VERDICT_WEAK: 0.5,
        VERDICT_BAD: 0.0,
        VERDICT_SKIPPED: 0.0,
        VERDICT_REPHRASED: 0.8,
    }
    score = sum(weights.get(v, 0.0) for v in verdicts) / len(verdicts)

    hard_flags = {"contradicts_own_work", "acknowledges_cheating"}
    if any(f in hard_flags for f in flags):
        return (BADGE_UNLIKELY, score)

    if score >= 0.75:
        return (BADGE_LIKELY, score)
    if score >= 0.40:
        return (BADGE_UNCERTAIN, score)
    return (BADGE_UNLIKELY, score)


async def start_integrity_check(
    submission_id: uuid.UUID,
    db: AsyncSession,
) -> None:
    """Run the (stubbed) integrity check pipeline for a fresh
    submission. Idempotent in the sense that if rows already exist
    for this submission (e.g. a retry), it bails — the unique
    constraint on (submission_id, bank_item_id) backs this up at the
    DB level.

    Caller is responsible for committing the surrounding transaction.
    """
    submission = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if submission is None:
        logger.warning("start_integrity_check: submission %s not found", submission_id)
        return

    assignment = (await db.execute(
        select(Assignment).where(Assignment.id == submission.assignment_id)
    )).scalar_one_or_none()
    if assignment is None:
        logger.warning(
            "start_integrity_check: assignment %s not found", submission.assignment_id,
        )
        return

    if not assignment.integrity_check_enabled:
        return

    # Defense in depth: the loop is for homework only.
    if assignment.type != "homework":
        return

    # Already-ran check: skip if any rows exist for this submission.
    existing = (await db.execute(
        select(IntegrityCheckProblem.id).where(
            IntegrityCheckProblem.submission_id == submission_id,
        ).limit(1)
    )).scalar_one_or_none()
    if existing is not None:
        return

    primary_id_strs = problem_ids_in_content(assignment.content)
    if not primary_id_strs:
        return

    sampled_strs = primary_id_strs[:MAX_SAMPLE]
    sampled_uuids: list[uuid.UUID] = []
    for s in sampled_strs:
        try:
            sampled_uuids.append(uuid.UUID(str(s)))
        except (ValueError, TypeError):
            logger.warning(
                "start_integrity_check: invalid bank id %r in assignment %s",
                s, assignment.id,
            )
            continue
    if not sampled_uuids:
        return

    # Hydrate the picked problems so we can pass each one's text to
    # the question generator. Single query.
    items_by_id: dict[uuid.UUID, QuestionBankItem] = {}
    rows = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id.in_(sampled_uuids))
    )).scalars().all()
    for it in rows:
        items_by_id[it.id] = it

    extraction = await extract_student_work(submission_id, db)

    # If the Vision model couldn't read the handwriting, mark all
    # sampled problems as unreadable and bail — no questions to ask.
    confidence = extraction.get("confidence", 0.0)
    if confidence < 0.3:
        logger.info(
            "Handwriting unreadable (confidence=%.2f) for submission %s",
            confidence, submission_id,
        )
        for sample_position, bid in enumerate(sampled_uuids):
            db.add(IntegrityCheckProblem(
                submission_id=submission_id,
                bank_item_id=bid,
                sample_position=sample_position,
                status=STATUS_SKIPPED_UNREADABLE,
                student_work_extraction=extraction,
                badge=BADGE_UNREADABLE,
            ))
        return

    for sample_position, bid in enumerate(sampled_uuids):
        item = items_by_id.get(bid)
        if item is None:
            # The picked problem was deleted between publish and now.
            # Skip silently — there's nothing to ask about.
            continue

        questions = await generate_questions(item.question, extraction)

        problem_row = IntegrityCheckProblem(
            submission_id=submission_id,
            bank_item_id=bid,
            sample_position=sample_position,
            status=STATUS_AWAITING_STUDENT,
            student_work_extraction=extraction,
        )
        db.add(problem_row)
        await db.flush()

        for q_index, q in enumerate(questions):
            db.add(IntegrityCheckResponse(
                integrity_check_problem_id=problem_row.id,
                question_index=q_index,
                question_text=q["question_text"],
                expected_shape=q.get("expected_shape"),
                rubric_hint=q.get("rubric_hint"),
            ))
