"""Calls whose unit was deleted — paid-for work with nothing left to hang off.

Two kinds, one treatment:

  a submission's calls      its submission was deleted (a student
                            re-uploads, a teacher clears one)
  a generation job's calls  its job went with a discarded draft or course

The work happened and was paid for; only the row it hung off is gone.
Its cost is that unit's cost — dropping it understates what one
homework or one generated unit costs, and leaving it to the residual
bucket counts it as per-user monthly AI, charged to every active user.

Which unit (and so which assignment type) it belonged to is
unrecoverable. So it rides on the window's surviving units pro rata:
each carries `per_unit` on top of its own calls — exactly "what it costs
to get one unit through, redos and discards included".
"""

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.llm_attribution import deleted_submission_calls
from api.models.llm_call import LLMCall
from api.models.question_bank import QuestionBankGenerationJob
from api.routes.admin_unit_economics_profiles import as_float
from api.routes.admin_unit_economics_scope import (
    PROFILE_COLS,
    Scope,
    deleted_generation_calls,
)


@dataclass
class OrphanCalls:
    calls: int = 0
    cost: float = 0.0
    # Surviving units in the window the cost is spread over.
    units: int = 0
    # Per (function, model) profile rows, for the per-function legs.
    rows: list[Any] = field(default_factory=list)

    @property
    def per_unit(self) -> float:
        return self.cost / self.units if self.units else 0.0

    def legs_for(self, kind: str, kind_units: float) -> list[Any]:
        """One kind's pro-rata share of the orphaned calls, as profile rows.

        Scaled so that dividing by the kind's own unit count (what
        profile_rows does) yields calls / ALL units — the same overhead
        every kind carries.
        """
        if not self.units:
            return []
        share = kind_units / self.units
        return [
            SimpleNamespace(
                kind=kind, function=r.function, model=r.model,
                calls=float(r.calls) * share, cost=as_float(r.cost) * share,
                avg_in=r.avg_in, avg_out=r.avg_out,
                avg_cread=r.avg_cread, avg_cwrite=r.avg_cwrite,
            )
            for r in self.rows
        ]

    def summary(self) -> dict[str, Any]:
        return {
            "calls": self.calls,
            "cost_usd": self.cost,
            "per_unit_usd": self.per_unit,
            "spread_over": self.units,
        }


async def _orphans(
    db: AsyncSession, scope: Scope, orphaned: ColumnElement[bool], units: int,
) -> OrphanCalls:
    rows = list((await db.execute(
        scope.apply(
            select(
                LLMCall.function.label("function"),
                LLMCall.model.label("model"),
                *PROFILE_COLS,
            ),
        ).where(orphaned).group_by(LLMCall.function, LLMCall.model),
    )).all())
    return OrphanCalls(
        calls=sum(int(r.calls) for r in rows),
        cost=sum(as_float(r.cost) for r in rows),
        units=units,
        rows=rows,
    )


async def deleted_submissions(db: AsyncSession, scope: Scope) -> OrphanCalls:
    """Spread over the window's surviving submissions — the same set the
    per-submission costs count."""
    units = (await db.execute(
        scope.apply(select(func.count(func.distinct(LLMCall.submission_id))))
        .where(LLMCall.submission_id.isnot(None), scope.started_in_window()),
    )).scalar() or 0
    return await _orphans(db, scope, deleted_submission_calls(), int(units))


async def deleted_generation_jobs(db: AsyncSession, scope: Scope) -> OrphanCalls:
    """Spread over the window's surviving teaching units — the same set the
    per-unit generation cost counts."""
    units = (await db.execute(
        scope.apply(
            select(func.count(func.distinct(QuestionBankGenerationJob.unit_id)))
            .select_from(LLMCall)
            .join(
                QuestionBankGenerationJob,
                QuestionBankGenerationJob.id == LLMCall.generation_job_id,
            ),
        ),
    )).scalar() or 0
    return await _orphans(db, scope, deleted_generation_calls(), int(units))
