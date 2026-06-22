"""Weak-spots endpoint — surfaces problems where the student's submitted
work was flagged by the diagnosis pipeline, so the Review tab can offer
targeted practice on what tripped them up.

The signal is `work_submissions.has_issues = true`. We dedupe by
problem text (a student often submits work on the same problem multiple
times until they get it) and keep the most recent diagnosis summary for
each. Results are subject-filtered via the parent session.
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.subjects import VALID_SUBJECTS
from api.database import get_db
from api.middleware.auth import get_current_user_full
from api.models.session import Session as SessionModel
from api.models.user import User
from api.models.work_submission import WorkSubmission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/weak-spots", tags=["weak-spots"])


class WeakSpotItem(BaseModel):
    problem_text: str
    summary: str
    submitted_at: datetime
    session_id: str | None
    issue_count: int


class WeakSpotsResponse(BaseModel):
    items: list[WeakSpotItem]


@router.get("", response_model=WeakSpotsResponse)
async def weak_spots(
    subject: str = Query(...),
    limit: int = Query(20, ge=1, le=50),
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> WeakSpotsResponse:
    """Return the user's most recent flagged problems for `subject`.

    Joins `work_submissions` against the parent `sessions` row to filter
    by subject, then groups by problem_text in Python so the most recent
    submission's summary wins and repeat attempts contribute to
    `issue_count` instead of polluting the list with duplicates.
    """
    if subject not in VALID_SUBJECTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid subject. Must be one of: {', '.join(sorted(VALID_SUBJECTS))}",
        )

    # Pull a generous window of recent flagged submissions; we'll dedupe
    # and trim to `limit` after grouping. 200 keeps a heavy user from
    # missing recent items even if they spammed work on one problem.
    query = (
        select(WorkSubmission, SessionModel.subject)
        .join(SessionModel, WorkSubmission.session_id == SessionModel.id)
        .where(
            WorkSubmission.user_id == user.id,
            WorkSubmission.has_issues.is_(True),
            SessionModel.subject == subject,
        )
        .order_by(desc(WorkSubmission.created_at))
        .limit(200)
    )
    result = await db.execute(query)
    rows = result.all()

    grouped: dict[str, WeakSpotItem] = {}
    for sub, _sess_subject in rows:
        key = sub.problem_text.strip()
        if not key:
            continue
        existing = grouped.get(key)
        if existing is None:
            grouped[key] = WeakSpotItem(
                problem_text=key,
                summary=sub.summary or "Work flagged for review",
                submitted_at=sub.created_at,
                session_id=str(sub.session_id) if sub.session_id else None,
                issue_count=1,
            )
        else:
            existing.issue_count += 1
            # Keep the most recent submitted_at + summary (rows are already
            # desc-ordered, so the first one wins).

    items = list(grouped.values())[:limit]
    return WeakSpotsResponse(items=items)
