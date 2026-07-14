"""Admin solution-quality endpoints — the AI-solution judge report.

Read-only analytics over the ``quality_scores`` table (an LLM-as-judge
score of each decomposition shown to students). Surfaces platform-wide
health of AI-generated solutions:

- The headline PASS RATE with a delta vs the prior comparable window,
  plus coverage (how many of the window's sessions were sampled) so the
  score is always read next to its sample size — it's a judge score, not
  ground truth.
- A pass-rate trend bucketed by day, and quality broken down by subject
  and mode (the judge score joins Session, which carries both).
- The evaluations list itself, defaulting worst-first, each row keyed to
  a real session so the UI can drill into the problem + steps + issues.

Analytics (summary / trend / breakdowns) always cover the whole window;
the ``only_failed`` toggle scopes only the evaluations *list*, so flipping
it never moves the headline numbers.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.quality_score import QualityScore
from api.models.session import Session
from api.routes.admin_helpers import time_range

router = APIRouter()

# passed = all four dimensions >= 4 (mirrors the judge). The worst-first
# ordering leans on the summed score as the tiebreaker after pass/fail.
_TOTAL_SCORE = (
    QualityScore.correctness
    + QualityScore.optimality
    + QualityScore.clarity
    + QualityScore.flow
)


def _pass_rate(passed: int, total: int) -> float:
    return round(passed / total * 100, 1) if total else 0.0


@router.get("/quality")
async def quality_scores(
    hours: int = Query(default=168, ge=1, le=2160),
    only_failed: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = time_range(hours)
    prior_since = time_range(hours * 2)  # the equal-length window before `since`

    passed_sum = func.sum(case((QualityScore.passed.is_(True), 1), else_=0))

    # ── Window summary (ignores only_failed — headline is window-wide) ──
    agg = (await db.execute(
        select(
            func.count().label("total"),
            passed_sum.label("passed"),
            func.avg(QualityScore.correctness).label("avg_correctness"),
            func.avg(QualityScore.optimality).label("avg_optimality"),
            func.avg(QualityScore.clarity).label("avg_clarity"),
            func.avg(QualityScore.flow).label("avg_flow"),
        ).where(QualityScore.created_at >= since)
    )).one()

    total = agg.total or 0
    passed = agg.passed or 0
    pass_rate = _pass_rate(passed, total)

    # Prior window pass rate → delta. Same length, immediately before.
    prior = (await db.execute(
        select(func.count().label("total"), passed_sum.label("passed"))
        .where(QualityScore.created_at >= prior_since, QualityScore.created_at < since)
    )).one()
    prior_total = prior.total or 0
    prior_pass_rate = _pass_rate(prior.passed or 0, prior_total)

    # Coverage — the judge samples sessions, so the score is only as
    # trustworthy as the fraction of sessions it actually looked at.
    total_sessions = (await db.execute(
        select(func.count()).select_from(Session).where(Session.created_at >= since)
    )).scalar_one() or 0

    # ── Pass-rate trend, bucketed by day ──
    day = func.date_trunc("day", QualityScore.created_at)
    trend_rows = (await db.execute(
        select(day.label("day"), func.count().label("total"), passed_sum.label("passed"))
        .where(QualityScore.created_at >= since)
        .group_by(day)
        .order_by(day)
    )).all()
    trend = [
        {
            "day": r.day.date().isoformat(),
            "evaluated": r.total or 0,
            "pass_rate": _pass_rate(r.passed or 0, r.total or 0),
        }
        for r in trend_rows
    ]

    # ── Quality by subject / by mode (join Session) ──
    async def _breakdown(dimension: Any) -> list[dict[str, Any]]:
        rows = (await db.execute(
            select(
                dimension.label("name"),
                func.count().label("total"),
                passed_sum.label("passed"),
                func.avg(_TOTAL_SCORE / 4.0).label("avg_score"),
            )
            .join(Session, Session.id == QualityScore.session_id)
            .where(QualityScore.created_at >= since)
            .group_by(dimension)
        )).all()
        return sorted(
            (
                {
                    "name": r.name or "unknown",
                    "evaluated": r.total or 0,
                    "passed": r.passed or 0,
                    "pass_rate": _pass_rate(r.passed or 0, r.total or 0),
                    "avg_score": round(float(r.avg_score or 0), 2),
                }
                for r in rows
            ),
            # Worst-first: lowest pass rate on top, then by sample size so
            # a thinly-sampled fluke doesn't outrank a real weak spot.
            key=lambda b: (b["pass_rate"], -b["evaluated"]),
        )

    by_subject = await _breakdown(Session.subject)
    by_mode = await _breakdown(Session.mode)

    # ── Evaluations list (the drill table; honors only_failed) ──
    list_filters = [QualityScore.created_at >= since]
    if only_failed:
        list_filters.append(QualityScore.passed.is_(False))

    list_total = (await db.execute(
        select(func.count()).select_from(QualityScore).where(*list_filters)
    )).scalar_one() or 0

    rows = (await db.execute(
        select(
            QualityScore,
            Session.problem,
            Session.subject,
            Session.mode,
            Session.problem_type,
        )
        .join(Session, Session.id == QualityScore.session_id)
        .where(*list_filters)
        # Worst-first: failures on top, then lowest total score, newest last.
        .order_by(
            QualityScore.passed.asc(),
            _TOTAL_SCORE.asc(),
            QualityScore.created_at.desc(),
        )
        .offset(offset)
        .limit(limit)
    )).all()

    return {
        "summary": {
            "total": total,
            "passed": passed,
            "failed": total - passed,
            "pass_rate": pass_rate,
            "prior_pass_rate": prior_pass_rate,
            "prior_total": prior_total,
            "total_sessions": total_sessions,
            "coverage_pct": _pass_rate(total, total_sessions),
            "avg_correctness": round(agg.avg_correctness or 0, 2),
            "avg_optimality": round(agg.avg_optimality or 0, 2),
            "avg_clarity": round(agg.avg_clarity or 0, 2),
            "avg_flow": round(agg.avg_flow or 0, 2),
        },
        "trend": trend,
        "by_subject": by_subject,
        "by_mode": by_mode,
        "scores": [
            {
                "id": str(qs.id),
                "session_id": str(qs.session_id),
                "problem": problem[:120],
                "subject": subject,
                "mode": mode,
                "problem_type": problem_type,
                "correctness": qs.correctness,
                "optimality": qs.optimality,
                "clarity": qs.clarity,
                "flow": qs.flow,
                "passed": qs.passed,
                "issues": qs.issues,
                "created_at": qs.created_at.isoformat(),
            }
            for qs, problem, subject, mode, problem_type in rows
        ],
        "total_count": list_total,
    }


@router.get("/quality/{session_id}")
async def quality_session_detail(
    session_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Drill-in for a single evaluated session: the problem, the exact
    decomposition steps shown to the student, and the judge's verdict.
    This is the destination the evaluations table deep-links into."""
    row = (await db.execute(
        select(Session, QualityScore)
        .outerjoin(QualityScore, QualityScore.session_id == Session.id)
        .where(Session.id == session_id)
    )).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session, score = row
    steps = [
        {
            "title": (s or {}).get("title", "") if isinstance(s, dict) else "",
            "description": (s or {}).get("description", "") if isinstance(s, dict) else str(s),
            "final_answer": (s or {}).get("final_answer") if isinstance(s, dict) else None,
        }
        for s in (session.steps or [])
    ]

    return {
        "session": {
            "id": str(session.id),
            "problem": session.problem,
            "problem_type": session.problem_type,
            "subject": session.subject,
            "mode": session.mode,
            "status": session.status,
            "total_steps": session.total_steps,
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "steps": steps,
        },
        "score": None if score is None else {
            "correctness": score.correctness,
            "optimality": score.optimality,
            "clarity": score.clarity,
            "flow": score.flow,
            "passed": score.passed,
            "issues": score.issues,
            "created_at": score.created_at.isoformat() if score.created_at else None,
        },
    }
