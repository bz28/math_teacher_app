"""Unit economics — what one homework, exam, or generated unit costs us.

The spend dashboard answers "what did we spend"; this answers "what does
one of each thing cost", which is the only form a margin conversation can
use. A blended $/student/month has no levers in it: it cannot say what
happens when a teacher assigns twice as much homework, or what we save by
moving grading to a cheaper model, because the homework and the grading
are averaged together.

Three denominators, because three costs behave differently as a class grows:

  submission units   per student, per submission   homework/quiz/test/practice
  generation         per teaching UNIT             amortises over the class
  residual AI        per active user, per month    tutoring, bank chat

Generation belongs to the unit, not the assignment: a teacher builds a
unit's problems once and draws assignments from it, so its cost divides by
class size while reading and grading does not. That asymmetry is the whole
reason this is split out rather than averaged.

Everything here is READ-ONLY and derived from rows we already write. The
response also carries per-function TOKEN profiles so the dashboard can
reprice a unit onto another model without another round trip — see
api/core/model_pricing.reprice for why that needs the tokenizer factor.
"""

import uuid as uuid_lib
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.llm_families import FAMILY_LABELS, family_for
from api.core.model_pricing import cost_usd, price_for
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.assignment import Assignment, Submission
from api.models.llm_call import LLMCall
from api.models.question_bank import QuestionBankGenerationJob
from api.models.user import User
from api.routes.admin_helpers import INTERNAL_SCHOOL_SENTINEL, Window
from api.routes.admin_unit_economics_measured import (
    MIN_RATE_DAYS,
    SUBMISSION_KINDS,
    measured_rates,
)
from api.routes.admin_unit_economics_orphans import (
    OrphanCalls,
    deleted_generation_jobs,
    deleted_submissions,
)
from api.routes.admin_unit_economics_profiles import as_float, catalog, profile_rows
from api.routes.admin_unit_economics_scope import (
    PROFILE_COLS,
    RESIDUAL,
    Scope,
    deleted_generation_calls,
)

router = APIRouter()

_DAYS_PER_MONTH = 30.0


# Below this many observations a unit cost is noise. The dashboard greys
# it out rather than rendering a number — a thin bucket that reads as
# $0.00 produces a 100% margin, which is exactly the figure that ends up
# in a board deck.
_DEFAULT_MIN_SAMPLE = 5

# Residual rates are per month too, so the same short-window guard as
# the measured usage rates applies (see MIN_RATE_DAYS).


def _median(col: Any) -> Any:
    return func.percentile_cont(0.5).within_group(col.asc())


def _p90(col: Any) -> Any:
    return func.percentile_cont(0.9).within_group(col.asc())



async def _resolve_window(
    db: AsyncSession, days: int | None,
) -> tuple[Window, str, str | None]:
    """The window to measure over.

    Defaults to "since the model changed" rather than a fixed lookback,
    and derives that date from the first real Opus 5.5 call instead of a
    hardcoded one — the commit landed 2026-10-28 but the rollout was
    observed from 2026-11-04, and a window that straddles the switch
    averages two different pricing regimes into one meaningless number.
    """
    until = datetime.now(UTC)
    if days is not None:
        return Window(until - timedelta(days=days), until), "fixed_days", None

    cutover = (
        await db.execute(
            select(func.min(LLMCall.created_at)).where(
                LLMCall.model.like(f"{settings.llm_model_opus}%"),
            ),
        )
    ).scalar()
    if cutover is None:
        # No calls on the current model yet (a fresh database, or a model
        # we have not shipped). Fall back to a month rather than scanning
        # all of history.
        return Window(until - timedelta(days=30), until), "no_cutover_found", None
    return Window(cutover, until), "model_cutover", settings.llm_model_opus


def _submission_join(stmt: Select[Any], scope: Scope) -> Select[Any]:
    """Join a call to its submission's assignment, keeping only submissions
    handed in inside the window (see Scope.submission_began_in_window)."""
    return stmt.join(Submission, Submission.id == LLMCall.submission_id).join(
        Assignment, Assignment.id == Submission.assignment_id,
    ).where(scope.submission_began_in_window())


async def _submission_units(
    db: AsyncSession, scope: Scope, deleted: OrphanCalls,
) -> list[dict[str, Any]]:
    """Cost of one submission, by assignment type.

    Cost is summed per submission FIRST and then aggregated, so the
    headline is "what one homework costs", not "what one call costs".
    The median leads: a student who photographs forty pages produces one
    very expensive call that should not set our rate card.

    Every figure includes the deleted-submission overhead (see
    admin_unit_economics_orphans), the same amount on each submission, so the
    median, mean and p90 all shift by it and the total by n times it.
    """
    per_submission = scope.apply(
        _submission_join(
            select(
                LLMCall.submission_id.label("sub"),
                Assignment.type.label("kind"),
                func.sum(LLMCall.cost_usd).label("cost"),
            ),
            scope,
        ),
    ).group_by(LLMCall.submission_id, Assignment.type).subquery()

    rows = (
        await db.execute(
            select(
                per_submission.c.kind,
                func.count().label("n"),
                _median(per_submission.c.cost).label("median"),
                func.avg(per_submission.c.cost).label("mean"),
                _p90(per_submission.c.cost).label("p90"),
                func.sum(per_submission.c.cost).label("total"),
            ).group_by(per_submission.c.kind),
        )
    ).all()

    by_kind = {r.kind: r for r in rows}
    extra = deleted.per_unit
    out: list[dict[str, Any]] = []
    for kind in SUBMISSION_KINDS:
        r = by_kind.get(kind)
        out.append(
            {
                "kind": f"submission:{kind}",
                "label": kind,
                "denominator": "per student per submission",
                "n": int(r.n) if r else 0,
                "cost_median": as_float(r.median) + extra if r else None,
                "cost_mean": as_float(r.mean) + extra if r else None,
                "cost_p90": as_float(r.p90) + extra if r else None,
                "cost_total": as_float(r.total) + extra * int(r.n) if r else 0.0,
            },
        )
    return out



async def _unit_functions(
    db: AsyncSession, scope: Scope, deleted: OrphanCalls, discarded: OrphanCalls,
) -> dict[str, list[dict[str, Any]]]:
    """Per-function decomposition, token profile, and a reprice matrix.

    Covers EVERY unit family, not just submissions. Generation and
    tutoring need a profile for the same two reasons the submission
    legs do: the dashboard seeds each model picker from the model those
    calls actually ran on, and a knob with no profile behind it silently
    does nothing when you move it.

    `calls_per_unit` is what makes repricing work: the understanding
    check fires several turns per homework, so its per-call median has to
    be multiplied back up before it compares with a single grading call.

    The reprice matrix is computed HERE rather than in the dashboard on
    purpose. Rescaling tokens by the tokenizer ratio, applying the target
    model's own cache-read multiplier, and handling Haiku 5.5's
    >100k-token cliff are each easy to get subtly wrong, and a second
    implementation in TypeScript would drift from the tested one.
    """
    out: dict[str, list[dict[str, Any]]] = {}

    # Submissions — denominator is the distinct submission.
    sub_rows = list(
        (
            await db.execute(
                scope.apply(
                    _submission_join(
                        select(
                            Assignment.type.label("kind"),
                            LLMCall.function.label("function"),
                            LLMCall.model.label("model"),
                            *PROFILE_COLS,
                        ),
                        scope,
                    ),
                ).group_by(Assignment.type, LLMCall.function, LLMCall.model),
            )
        ).all(),
    )
    sub_denoms = {
        f"submission:{r.kind}": float(r.units)
        for r in (
            await db.execute(
                scope.apply(
                    _submission_join(
                        select(
                            Assignment.type.label("kind"),
                            func.count(func.distinct(LLMCall.submission_id))
                            .label("units"),
                        ).select_from(LLMCall),
                        scope,
                    ),
                ).group_by(Assignment.type),
            )
        ).all()
    }
    for kind, units in sub_denoms.items():
        sub_rows.extend(deleted.legs_for(kind.removeprefix("submission:"), units))
    out.update(
        profile_rows(
            sub_rows,
            key_of=lambda r: f"submission:{r.kind}",
            denominators=sub_denoms,
        ),
    )

    # Generation — denominator is the teaching UNIT, matching _generation_unit.
    gen_rows = list(
        (
            await db.execute(
                scope.apply(
                    select(
                        LLMCall.function.label("function"),
                        LLMCall.model.label("model"),
                        *PROFILE_COLS,
                    ).join(
                        QuestionBankGenerationJob,
                        QuestionBankGenerationJob.id == LLMCall.generation_job_id,
                    ),
                ).where(scope.unit_began_in_window())
                .group_by(LLMCall.function, LLMCall.model),
            )
        ).all(),
    )
    gen_units = (
        await db.execute(
            scope.apply(
                select(
                    func.count(func.distinct(QuestionBankGenerationJob.unit_id)),
                ).select_from(LLMCall).join(
                    QuestionBankGenerationJob,
                    QuestionBankGenerationJob.id == LLMCall.generation_job_id,
                ),
            ).where(scope.unit_began_in_window()),
        )
    ).scalar() or 1
    gen_rows.extend(discarded.legs_for("generation", float(gen_units)))
    out.update(
        profile_rows(
            gen_rows,
            key_of=lambda _r: "generation:unit",
            denominators={"generation:unit": float(gen_units)},
        ),
    )

    # Residual — denominator is active users x months, so cost_per_unit
    # reads as "per active user per month", matching _residual_units.
    months = scope.days / _DAYS_PER_MONTH
    res_rows = list(
        (
            await db.execute(
                scope.apply(
                    select(
                        User.role.label("role"),
                        LLMCall.function.label("function"),
                        LLMCall.model.label("model"),
                        *PROFILE_COLS,
                    ).join(User, User.id == LLMCall.user_id),
                )
                .where(*RESIDUAL, User.role.in_(("student", "teacher")))
                .group_by(User.role, LLMCall.function, LLMCall.model),
            )
        ).all(),
    )
    res_denoms = {
        f"residual:{r.role}": max(float(r.units), 1.0) * max(months, 1e-9)
        for r in (
            await db.execute(
                scope.apply(
                    select(
                        User.role.label("role"),
                        func.count(func.distinct(LLMCall.user_id)).label("units"),
                    ).select_from(LLMCall).join(User, User.id == LLMCall.user_id),
                )
                .where(*RESIDUAL, User.role.in_(("student", "teacher")))
                .group_by(User.role),
            )
        ).all()
    }
    out.update(
        profile_rows(
            res_rows,
            key_of=lambda r: f"residual:{r.role}",
            denominators=res_denoms,
        ),
    )
    return out



async def _generation_unit(
    db: AsyncSession, scope: Scope, discarded: OrphanCalls,
) -> dict[str, Any]:
    """Cost of generating one teaching unit's problems.

    Grouped by the job's `unit_id`, not by job: one unit's cost is every
    generation run for it in the window, regenerations included — that is
    what building it costs, and what amortises over a class. `runs_per_unit`
    says how many runs that took, so a regeneration-heavy unit reads as one.
    """
    per_unit = scope.apply(
        select(
            QuestionBankGenerationJob.unit_id.label("unit"),
            func.sum(LLMCall.cost_usd).label("cost"),
            func.count(func.distinct(QuestionBankGenerationJob.id)).label("runs"),
        ).join(
            QuestionBankGenerationJob,
            QuestionBankGenerationJob.id == LLMCall.generation_job_id,
        ),
    ).where(scope.unit_began_in_window()).group_by(
        QuestionBankGenerationJob.unit_id,
    ).subquery()

    r = (
        await db.execute(
            select(
                func.count().label("n"),
                _median(per_unit.c.cost).label("median"),
                func.avg(per_unit.c.cost).label("mean"),
                _p90(per_unit.c.cost).label("p90"),
                func.sum(per_unit.c.cost).label("total"),
                func.avg(per_unit.c.runs).label("runs"),
            ),
        )
    ).one()

    # Plus each unit's share of jobs discarded with their draft (see
    # admin_unit_economics_orphans).
    extra = discarded.per_unit
    return {
        "kind": "generation:unit",
        "label": "unit generation",
        "denominator": "per teaching unit",
        "n": int(r.n),
        "cost_median": as_float(r.median) + extra if r.n else None,
        "cost_mean": as_float(r.mean) + extra if r.n else None,
        "cost_p90": as_float(r.p90) + extra if r.n else None,
        "cost_total": as_float(r.total) + extra * int(r.n),
        "runs_per_unit": as_float(r.runs) if r.n else None,
    }


async def _residual_units(db: AsyncSession, scope: Scope) -> list[dict[str, Any]]:
    """Everything tied to neither a submission nor a generation job.

    Tutoring, practice, question-bank chat, unit suggestions. Split by the
    role of the user who caused it, because teacher-side AI scales with
    TEACHERS and self-study scales with STUDENTS — folding them together
    hides a difference that gets large at district scale.

    Denominated per active user per 30 days so the figure survives a
    window of any length.
    """
    rows = (
        await db.execute(
            scope.apply(
                select(
                    User.role.label("role"),
                    func.sum(LLMCall.cost_usd).label("cost"),
                    func.count(func.distinct(LLMCall.user_id)).label("actives"),
                    func.count().label("calls"),
                ).join(User, User.id == LLMCall.user_id),
            )
            .where(*RESIDUAL)
            .group_by(User.role),
        )
    ).all()

    months = scope.days / _DAYS_PER_MONTH

    # A real distribution, not one derived rate reported twice. Sum per
    # USER first, then take the median across users — the same shape
    # _submission_units uses, and the only thing that makes the
    # dashboard's "Median" column header true for these rows. One heavy
    # tutoring user should move the mean and not the median.
    per_user = scope.apply(
        select(
            User.role.label("role"),
            LLMCall.user_id.label("uid"),
            func.sum(LLMCall.cost_usd).label("cost"),
        ).select_from(LLMCall).join(User, User.id == LLMCall.user_id),
    ).where(
        *RESIDUAL, User.role.in_(("student", "teacher")),
    ).group_by(User.role, LLMCall.user_id).subquery()

    dist = {
        r.role: r
        for r in (
            await db.execute(
                select(
                    per_user.c.role,
                    _median(per_user.c.cost).label("median"),
                    func.avg(per_user.c.cost).label("mean"),
                    _p90(per_user.c.cost).label("p90"),
                ).group_by(per_user.c.role),
            )
        ).all()
    }

    by_role = {r.role: r for r in rows}
    out: list[dict[str, Any]] = []
    for role, kind, label in (
        ("student", "residual:student", "self-study"),
        ("teacher", "residual:teacher", "teacher-side AI"),
    ):
        r = by_role.get(role)
        d = dist.get(role)
        actives = int(r.actives) if r and r.actives else 0
        total = as_float(r.cost) if r else 0.0
        per_month = (1.0 / months) if months > 0 else 0.0
        out.append(
            {
                "kind": kind,
                "label": label,
                "denominator": f"per active {role} per month",
                "n": actives,
                "cost_median": (as_float(d.median) * per_month) if (d and actives) else None,
                "cost_mean": (as_float(d.mean) * per_month) if (d and actives) else None,
                "cost_p90": (as_float(d.p90) * per_month) if (d and actives) else None,
                "cost_total": total,
                # A month's rate read off a few hours is not a measurement.
                "window_too_short": scope.days < MIN_RATE_DAYS,
            },
        )
    return out


async def _reconciliation(db: AsyncSession, scope: Scope) -> dict[str, Any]:
    """Recorded spend vs. the same tokens priced at published rates.

    The two should agree. A gap means a model is priced wrong in the
    catalog or missing from it — which is exactly how the flat cache-read
    multiplier went unnoticed for a month. Surfacing it permanently is
    cheaper than discovering it again.
    """
    rows = (
        await db.execute(
            scope.apply(
                select(
                    LLMCall.model.label("model"),
                    func.count().label("calls"),
                    func.sum(LLMCall.cost_usd).label("recorded"),
                    func.sum(LLMCall.input_tokens).label("in_t"),
                    func.sum(LLMCall.output_tokens).label("out_t"),
                    func.sum(LLMCall.cache_read_tokens).label("cread"),
                    func.sum(LLMCall.cache_write_tokens).label("cwrite"),
                ),
            ).group_by(LLMCall.model),
        )
    ).all()

    recorded = 0.0
    recomputed = 0.0
    calls = 0
    unpriced: list[str] = []
    per_model: list[dict[str, Any]] = []

    for r in rows:
        calls += int(r.calls)
        recorded += as_float(r.recorded)
        price = price_for(r.model)
        if price is None:
            unpriced.append(r.model)
            # No invented figure: an unpriced model contributes its
            # recorded cost so the totals still balance, and is named so
            # the dashboard can say the comparison is incomplete.
            recomputed += as_float(r.recorded)
            model_recomputed = None
        else:
            # Summed tokens are exact for flat-rate models. Haiku 5.5's
            # >100k-token cliff is per call, so if we ever run it this
            # needs to move per-row.
            model_recomputed = cost_usd(
                price,
                input_tokens=int(as_float(r.in_t)),
                output_tokens=int(as_float(r.out_t)),
                cache_read_tokens=int(as_float(r.cread)),
                cache_write_tokens=int(as_float(r.cwrite)),
            )
            recomputed += model_recomputed
        per_model.append(
            {
                "model": r.model,
                "calls": int(r.calls),
                "recorded_usd": as_float(r.recorded),
                "recomputed_usd": model_recomputed,
                "priced": price is not None,
            },
        )

    per_model.sort(key=lambda m: m["recorded_usd"], reverse=True)
    gap_pct = ((recorded - recomputed) / recomputed * 100.0) if recomputed else 0.0
    return {
        "call_count": calls,
        "recorded_usd": recorded,
        "recomputed_usd": recomputed,
        "gap_pct": gap_pct,
        "unpriced_models": sorted(set(unpriced)),
        "by_model": per_model,
    }


async def _models_in_use(db: AsyncSession, scope: Scope) -> dict[str, Any]:
    """The model each stage actually ran on in the window — the one that
    took the most spend — so every model picker defaults to reality.
    Every stage is listed; one that didn't run has model None."""
    rows = (
        await db.execute(
            scope.apply(
                select(
                    LLMCall.function,
                    LLMCall.model,
                    or_(
                        LLMCall.generation_job_id.isnot(None),
                        deleted_generation_calls(),
                    ).label("in_generation"),
                    func.sum(LLMCall.cost_usd).label("cost"),
                ),
            ).group_by(LLMCall.function, LLMCall.model, "in_generation"),
        )
    ).all()
    # Keyed by catalog model, so a dated id and its plain id (one model,
    # logged two ways across a config change) pool their spend.
    spend: dict[tuple[str, str], float] = {}
    for r in rows:
        family = family_for(r.function, bool(r.in_generation))
        if family != "other":
            price = price_for(r.model)
            key = (family, price.id if price else r.model)
            spend[key] = spend.get(key, 0.0) + as_float(r.cost)
    # Every stage, in the picker's order, so the dashboard names stages
    # from here rather than a copy; one that didn't run has no model.
    out: dict[str, Any] = {
        family: {"label": label, "model": None, "catalog_id": None, "cost_usd": 0.0}
        for family, label in FAMILY_LABELS.items()
    }
    # Ties broken on model id so identical requests answer identically.
    for (family, model), cost in sorted(spend.items()):
        if out[family]["model"] is None or cost > out[family]["cost_usd"]:
            price = price_for(model)
            out[family].update(
                model=model, catalog_id=price.id if price else None, cost_usd=cost,
            )
    return out


@router.get("/unit-economics")
async def unit_economics(
    days: int | None = Query(default=None, ge=1, le=3650),
    school_id: str | None = Query(default=None),
    exclude_internal: bool = Query(default=True),
    min_sample: int = Query(default=_DEFAULT_MIN_SAMPLE, ge=1, le=1000),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if school_id and school_id != INTERNAL_SCHOOL_SENTINEL:
        try:
            uuid_lib.UUID(school_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail="invalid school_id") from e

    window, window_basis, cutover_model = await _resolve_window(db, days)
    scope = Scope(window, school_id, exclude_internal)
    deleted = await deleted_submissions(db, scope)
    discarded = await deleted_generation_jobs(db, scope)

    units = await _submission_units(db, scope, deleted)
    units.append(await _generation_unit(db, scope, discarded))
    units.extend(await _residual_units(db, scope))
    for u in units:
        # Popped FIRST: `and` short-circuits, so folding the pop into the
        # expression left the key in the response on every row that failed
        # the sample check — which is the common case, not the rare one.
        too_short = bool(u.pop("window_too_short", False))
        u["sufficient"] = u["n"] >= min_sample and not too_short
        u["window_too_short"] = too_short

    return {
        "window": {
            "start": window.start.isoformat(),
            "end": window.end.isoformat(),
            "days": scope.days,
            "basis": window_basis,
            "cutover_model": cutover_model,
        },
        "units": units,
        "functions_by_unit": await _unit_functions(db, scope, deleted, discarded),
        "deleted_submissions": deleted.summary(),
        "deleted_generation_jobs": discarded.summary(),
        "reconciliation": await _reconciliation(db, scope),
        "measured": await measured_rates(db, window, school_id, exclude_internal),
        "models_in_use": await _models_in_use(db, scope),
        "model_catalog": catalog(),
        "min_sample": min_sample,
    }
