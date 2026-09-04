"""Re-run extraction for submissions whose background task died.

Why this exists: extraction is fire-and-forget. `_run_extraction_background`
has exactly one caller — the spawn inside submit_homework — and there is no
retry, no queue, no sweeper. When the task dies (on 2026-09-03, because the
anthropic SDK floated to 1.3.0 and dropped the `temperature` kwarg), the
submission is durable but permanently unprocessable: the student's post-submit
screen spins for 90s and then shows "Couldn't prepare your check", forever.

This calls the SAME function the app would have called, so the student's flow
resumes exactly as if it had worked the first time — next page load hands them
the confirm screen.

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

    from api.database import get_session_factory
    from api.models.assignment import Assignment, Submission
    from api.routes.school_student_practice import _run_extraction_background

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

    print("\n  running extraction (one Vision call, may take 5-15s)...")
    await _run_extraction_background(submission_id)

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

    # _run_extraction_background never re-raises, so confirm by re-reading
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
