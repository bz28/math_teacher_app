"""Re-run extraction for submissions whose background task died.

Why this exists: a job whose retry budget is spent parks as `failed` and
waits for a human, by design — a photo that will never read must stop
burning a Vision call on every drain. This is how a human says "the cause
is fixed, try again".

It RE-ENQUEUES rather than running extraction directly. That matters: a
direct call would bypass the very machinery built to make this
recoverable, so a second failure would again leave nothing behind.
Through the queue, a failure lands on the row as `last_error`, the retry
budget resets, and the drain owns it from there.

Before `extraction_jobs` existed this script was the ONLY recovery path,
and on 2026-09-03 it was run by hand against production at 2am to rescue
one student whose submission the anthropic SDK outage had stranded.

SAFETY
  * Dry-run by default. Pass --apply to actually write.
  * Refuses to touch a submission that already has an extraction, or that the
    student has already confirmed or flagged.
  * Refuses to run if the installed anthropic SDK still rejects `temperature`
    — otherwise it reproduces the exact crash it is meant to repair.
  * Targets one explicit submission id; there is no "fix everything" mode.

USAGE
  export DATABASE_URL=<prod url, postgresql+asyncpg://...>
  python retrigger_extraction.py <submission-id>            # dry run
  python retrigger_extraction.py <submission-id> --apply    # do it
"""

from __future__ import annotations

import asyncio
import inspect
import os
import sys
import uuid


def _preflight_sdk() -> None:
    """Refuse to run against an SDK that would crash the same way."""
    import anthropic

    params = inspect.signature(
        anthropic.AsyncAnthropic(api_key="preflight").messages.create
    ).parameters
    if "temperature" not in params:
        sys.exit(
            f"REFUSING: anthropic {anthropic.__version__} does not accept "
            "`temperature`, which is exactly the bug that stranded this "
            "submission. Deploy the pin first."
        )
    print(f"  anthropic {anthropic.__version__} — accepts temperature ✓")



async def _record_intervention(submission_id: uuid.UUID, steps: int) -> None:
    """Leave a trace that a HUMAN re-ran this, not the app.

    Without it the dashboard shows a submission with an extraction and
    zero model calls — which reads as "this appeared from nowhere" and
    is actively misleading to whoever debugs it next. The cost row alone
    is not enough either: it looks like an ordinary extraction, with
    nothing to distinguish the app doing its job from someone running a
    script against production.

    Written directly rather than through `record_activity`, which wants
    a CurrentUser this has no notion of. actor_user_id stays NULL and
    actor_role is "system" — nobody logged in, and pretending otherwise
    would put a real person's id on an action they did not take.
    """
    from sqlalchemy import text

    from api.database import get_session_factory

    try:
        async with get_session_factory()() as db:
            await db.execute(
                text(
                    "INSERT INTO activity_log "
                    "(id, actor_user_id, actor_role, school_id, action, "
                    " target_type, target_id, action_metadata) "
                    "SELECT gen_random_uuid(), NULL, 'system', c.school_id, "
                    "  'submission.extraction_retriggered', 'submission', "
                    "  s.id, :meta::jsonb "
                    "FROM submissions s "
                    "JOIN assignments a ON a.id = s.assignment_id "
                    "JOIN courses c ON c.id = a.course_id "
                    "WHERE s.id = :sid"
                ),
                {
                    "sid": submission_id,
                    "meta": f'{{"steps": {steps}, "tool": "retrigger_extraction.py"}}',
                },
            )
            await db.commit()
        print("  ✓ intervention recorded in activity_log")
    except Exception as exc:  # noqa: BLE001 — never fail the rescue over the audit
        print(f"  ! could not record the intervention: {exc}")


async def main(submission_id: uuid.UUID, apply: bool) -> None:
    from sqlalchemy import select

    from api.core.extraction_queue import (
        STALE_RUNNING_MINUTES,
        drain,
        enqueue_submission,
    )
    from api.database import get_session_factory
    from api.models.assignment import Assignment, Submission

    async with get_session_factory()() as db:
        sub = (await db.execute(
            select(Submission).where(Submission.id == submission_id)
        )).scalar_one_or_none()
        if sub is None:
            sys.exit(f"no submission {submission_id}")

        assignment = (await db.execute(
            select(Assignment).where(Assignment.id == sub.assignment_id)
        )).scalar_one_or_none()
        if assignment is None:
            sys.exit("submission has no assignment")

        print(f"  submission     : {sub.id}")
        print(f"  submitted_at   : {sub.submitted_at}")
        print(f"  files          : {len(sub.files or [])}")
        print(f"  extraction     : {'present' if sub.extraction else 'NULL'}")
        print(f"  confirmed_at   : {sub.extraction_confirmed_at}")
        print(f"  flagged_at     : {sub.extraction_flagged_at}")
        sub_assignment_id = sub.assignment_id
        print(f"  integrity/grade: {assignment.integrity_check_enabled}"
              f"/{assignment.ai_grading_enabled}")

        # Guards — each of these means "this is not a stranded submission",
        # and re-running would either waste a Vision call or clobber state
        # the student already acted on.
        if sub.extraction is not None:
            sys.exit("REFUSING: already has an extraction — nothing stranded.")
        if sub.extraction_confirmed_at is not None:
            sys.exit("REFUSING: student already confirmed.")
        if sub.extraction_flagged_at is not None:
            sys.exit("REFUSING: student already flagged the read.")
        if not (assignment.integrity_check_enabled or assignment.ai_grading_enabled):
            sys.exit(
                "REFUSING: both pipeline toggles are off, so extraction is "
                "not supposed to run for this assignment."
            )
        if not sub.files:
            sys.exit("REFUSING: submission has no files to extract.")

    if not apply:
        print("\nDRY RUN — would re-run extraction. Re-run with --apply.")
        return

    print("\n  re-enqueueing and draining (one Vision call, may take 5-15s)...")
    async with get_session_factory()() as db:
        assignment = (await db.execute(
            select(Assignment).where(Assignment.id == sub_assignment_id)
        )).scalar_one()
        # Commits on its own session; nothing to commit here.
        status = await enqueue_submission(submission_id, assignment)

    if status == "running":
        # The upsert deliberately leaves an in-flight job alone, and a
        # `running` row is exactly what "stuck" looks like from outside.
        # Draining now would run somebody else's job and then report
        # THIS rescue as failed, so say what is actually happening.
        print(
            "\n  a drain already owns this job (status=running).\n"
            "  Wait for it, or if the worker is gone wait "
            f"{STALE_RUNNING_MINUTES} minutes for the sweeper to\n"
            "  reclaim it, then re-run this script."
        )
        return
    if status is None:
        print("\n✗ could not queue the job — see the log above.")
        sys.exit(1)
    # `only=`, not `first=`. `first` merely PREFERS this submission and
    # falls back to the oldest queued job when it cannot be claimed —
    # which would bill a Vision call against an unrelated student and
    # then report THIS rescue as failed, at 2am, on the one tool you
    # reach for during an incident. `only` runs this job or nothing.
    tally = await drain(only=submission_id)
    print(f"  drain: {tally}")

    # Flush the cost log before the loop closes. _log_and_persist hands the
    # llm_calls row to fire_and_forget_persist, which is a create_task —
    # inside uvicorn the loop outlives the request and the row lands, but
    # `asyncio.run` cancels pending tasks the moment main() returns. Without
    # this the script makes a real, BILLED Vision call that appears nowhere:
    # no cost row, no audit trail of a manual production intervention.
    from api.core.llm_logging import _background_tasks

    if _background_tasks:
        print(f"  flushing {len(_background_tasks)} pending cost-log write(s)...")
        await asyncio.gather(*list(_background_tasks), return_exceptions=True)

    # The drain reports its own tally, but confirm the RESULT by re-reading
    # rather than trusting that it returned.
    async with get_session_factory()() as db:
        after = (await db.execute(
            select(Submission.extraction).where(Submission.id == submission_id)
        )).scalar_one_or_none()

    if after:
        steps = len(after.get("steps") or [])
        await _record_intervention(submission_id, steps)
        print(f"  ✓ extraction written — {steps} steps")
        print("    The student's next page load shows the confirm screen.")
    else:
        print("  ✗ extraction still NULL — it failed again.")
        print("    Check the app logs; the traceback is not written to the DB.")
        sys.exit(1)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    if not os.environ.get("DATABASE_URL"):
        sys.exit("set DATABASE_URL to the production database first")

    print("pre-flight:")
    _preflight_sdk()
    asyncio.run(main(uuid.UUID(args[0]), apply="--apply" in sys.argv))
