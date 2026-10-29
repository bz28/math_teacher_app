"""Homework points: what each problem is worth, and the score they add up to.

A homework has a total (`Assignment.total_points`, default 100). Until the
teacher types a number for a problem, the total is split evenly across the
problems in order, in whole points, remainder to the first ones: 100 over 7
is 15, 15, 14, 14, 14, 14, 14. Once she does, `Assignment.problem_points`
holds every problem's points and the total is their sum.

Grades stay a percent per problem (`breakdown[].percent`), so changing
points never rewrites a grade, only the score it adds up to: points earned
over points possible. With equal points that is exactly the plain average
homeworks used before points existed, which is why old homeworks were
backfilled at 10 points per problem.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.services.bank import problem_ids_in_content

DEFAULT_TOTAL_POINTS = 100
MAX_TOTAL_POINTS = 1000


def even_split(total: int, count: int) -> list[int]:
    """`total` in whole points over `count` problems, remainder first.
    Every problem is worth at least 1, so a total smaller than the
    problem count (problems added after it was set) can't make one free."""
    if count <= 0:
        return []
    base, extra = divmod(max(total, count), count)
    return [base + 1 if i < extra else base for i in range(count)]


def problem_points(
    total_points: int, custom: dict[str, Any] | None, problem_ids: list[str],
) -> dict[str, int]:
    """Each problem's points, in problem order.

    A problem added after the teacher set points by hand gets the average
    of the others, so one new problem doesn't swing the total."""
    if not custom:
        return dict(zip(problem_ids, even_split(total_points, len(problem_ids)), strict=True))
    known = [int(v) for k, v in custom.items() if k in problem_ids]
    fill = max(1, round(sum(known) / len(known))) if known else 1
    return {pid: int(custom[pid]) if pid in custom else fill for pid in problem_ids}


def assignment_points(assignment: Assignment) -> dict[str, int]:
    return problem_points(
        assignment.total_points, assignment.problem_points,
        problem_ids_in_content(assignment.content),
    )


def weighted_percent(
    percents: Iterable[tuple[str, float]], points: dict[str, int],
) -> float | None:
    """Points earned over points possible, as a percent, for the problems
    that have a percent. None when nothing is graded."""
    earned = possible = 0.0
    for pid, percent in percents:
        weight = points.get(pid, 0)
        earned += percent * weight
        possible += weight
    return earned / possible if possible else None


async def rescore_assignment(db: AsyncSession, assignment: Assignment) -> None:
    """Re-weigh every saved grade on `assignment` after its points
    changed. Per-problem grades don't move; `final_score` and the AI's
    `ai_score` are re-added from them. A score that moved gets a fresh
    `graded_at`, so a published grade reads as changed-since-publishing
    and reaches the student only when the teacher republishes."""
    points = assignment_points(assignment)
    grades = (await db.execute(
        select(SubmissionGrade)
        .join(Submission, Submission.id == SubmissionGrade.submission_id)
        .where(Submission.assignment_id == assignment.id)
        .with_for_update(of=SubmissionGrade)
    )).scalars().all()
    now = datetime.now(UTC)
    for g in grades:
        if g.breakdown:
            score = weighted_percent(((e["problem_id"], e["percent"]) for e in g.breakdown), points)
            if (score is None) != (g.final_score is None) or (
                score is not None and g.final_score is not None and abs(score - g.final_score) > 1e-6
            ):
                g.final_score = score
                g.graded_at = now
        ai_percents = (g.ai_breakdown or {}).get("problem_percents")
        if ai_percents:
            g.ai_score = weighted_percent(ai_percents.items(), points)
