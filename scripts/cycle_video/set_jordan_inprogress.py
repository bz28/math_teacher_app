"""Flip Jordan's integrity check to `in_progress` so the STUDENT route
renders the live turn-by-turn chat during recording.

The app's student homework page only routes to the chat UI while a check
is `awaiting_student` / `in_progress`; a `complete` check routes to the
submitted read-only view instead. The teacher-verdict scene needs the
check `complete` (a resolved flag), but the student-POV chat scene needs
it live — so we record the two scenes in two DB states:

  1.  scripts.cycle_video_prep                 → seeds COMPLETE flag
  2.  record ... 4-verdict (+ all non-chat scenes)   (complete state)
  3.  scripts.cycle_video.set_jordan_inprogress → flips to in_progress
  4.  record ... 4-chat                              (live chat)
  5.  scripts.cycle_video_prep                 → restores COMPLETE flag

This drops the agent's closing wrap turn so the live chat ends on the
student's hollow answer (the catch beat), and marks the sampled problem
`pending` (no verdict yet) — a truthful in-progress snapshot.

Run:  PYTHONPATH=. .venv/bin/python -m scripts.cycle_video.set_jordan_inprogress
"""

from __future__ import annotations

import asyncio
import uuid

from sqlalchemy import delete, select

from api.database import get_session_factory
from api.models.integrity_check import (
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)

JORDAN_LIN_SUB = uuid.UUID("729a070d-4250-497c-bdc7-887e3280fa29")


async def main() -> None:
    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission).where(
                IntegrityCheckSubmission.submission_id == JORDAN_LIN_SUB)
        )).scalar_one()
        # Live, mid-conversation snapshot — no verdict emitted yet.
        check.status = "in_progress"
        check.disposition = None
        check.headline = None
        check.overall_summary = None
        check.resolution = "unresolved"

        prob = (await s.execute(
            select(IntegrityCheckProblem).where(
                IntegrityCheckProblem.integrity_check_submission_id == check.id)
        )).scalar_one()
        prob.status = "pending"
        prob.rubric = None

        # Drop the agent's closing wrap so the live chat ends on the
        # student's last hollow answer.
        turns = (await s.execute(
            select(IntegrityConversationTurn)
            .where(IntegrityConversationTurn.integrity_check_submission_id == check.id)
            .order_by(IntegrityConversationTurn.ordinal.desc())
        )).scalars().all()
        if turns and turns[0].role == "agent":
            await s.execute(delete(IntegrityConversationTurn).where(
                IntegrityConversationTurn.id == turns[0].id))

        await s.commit()
    print("flipped Jordan's integrity check to in_progress (live chat state)")


if __name__ == "__main__":
    asyncio.run(main())
