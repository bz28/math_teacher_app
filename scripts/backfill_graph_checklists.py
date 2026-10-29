"""Write graph checklists for approved graph questions that have none.

Checklists are written when a teacher approves a graph question
(api/core/graph_checklist.py). Questions approved before that existed
(~13 in prod, Oct 2026) have none; this writes theirs with the same
function the app uses, so each comes out exactly as an approval today
would have written it.

SAFETY
  * Dry-run by default: lists what it would write, calls no model.
    Pass --apply to write (one Sonnet call per question).
  * Only questions with no checklist: never touches one a teacher edited,
    or one the app already wrote. Safe to re-run.
  * Each write re-checks the question under a row lock before saving
    (write_checklist), so a teacher editing it mid-run wins.

USAGE
  export DATABASE_URL=<prod url, postgresql+asyncpg://...>
  python -m scripts.backfill_graph_checklists            # dry run
  python -m scripts.backfill_graph_checklists --apply    # write them
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select


async def main(apply: bool) -> None:
    from api.core.graph_checklist import needs_checklist, problem_points, write_checklist
    from api.database import get_session_factory
    from api.models.question_bank import QuestionBankItem

    async with get_session_factory()() as db:
        candidates = (await db.execute(
            select(QuestionBankItem).where(
                QuestionBankItem.status == "approved",
                QuestionBankItem.requires_drawing.is_(True),
                QuestionBankItem.parent_question_id.is_(None),
                QuestionBankItem.graph_checklist.is_(None),
            ).order_by(QuestionBankItem.created_at)
        )).scalars().all()
        todo = []
        for item in candidates:
            points = await problem_points(db, item)
            ok = needs_checklist(item) and bool(points)
            print(f"  {'write' if ok else 'skip '} {item.id}  {points or '-':>3} pts  {item.title[:60]}")
            if ok:
                todo.append(item.id)
        print(f"{len(todo)} to write, {len(candidates) - len(todo)} skipped (no answer key or not on its homework)")
        if not apply:
            print("Dry run: nothing written. Pass --apply to write.")
            return
        written = 0
        for item_id in todo:
            try:
                ok = await write_checklist(db, item_id, user_id=None)
            except Exception as e:  # noqa: BLE001 — report and carry on
                await db.rollback()
                print(f"  FAILED {item_id}: {e}")
                continue
            written += ok
            print(f"  {'wrote  ' if ok else 'nothing'} {item_id}")
        print(f"Wrote {written} of {len(todo)}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the checklists (default: dry run)")
    asyncio.run(main(parser.parse_args().apply))
