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
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.model_pricing import cost_usd, price_for
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.assignment import Assignment, Submission
from api.models.llm_call import LLMCall
from api.models.question_bank import QuestionBankGenerationJob
from api.models.user import User
from api.routes.admin_helpers import INTERNAL_SCHOOL_SENTINEL
from api.routes.admin_unit_economics_profiles import as_float, catalog, profile_rows

router = APIRouter()

_DAYS_PER_MONTH = 30.0

# Harness grading calls. They carry a real cost but no customer, and
# including them would price our own test runs into a school's bill.
_EXCLUDED_FUNCTIONS = ("judge",)

# Assignment.type values, in the order the dashboard lists them.
_SUBMISSION_KINDS = ("homework", "quiz", "test", "practice")

# Below this many observations a unit cost is noise. The dashboard greys
# it out rather than rendering a number — a thin bucket that reads as
# $0.00 produces a 100% margin, which is exactly the figure that ends up
# in a board deck.
_DEFAULT_MIN_SAMPLE = 5

# A per-month rate extrapolated from a window far shorter than a month is
# arithmetic, not measurement. The DEFAULT window is "since the model
# changed", so the hour after a model switch it is an hour long: five
# students and $0.20 of tutoring would report $173 per student per month
# with n=5 and no warning at all. Residual units below this are reported
# with their figures intact but flagged insufficient, so the page greys
# them and the simulator's thin-data banner fires.
_MIN_RESIDUAL_DAYS = 7.0


def _median(col: Any) -> Any:
    return func.percentile_cont(0.5).within_group(col.asc())


def _p90(col: Any) -> Any:
    return func.percentile_cont(0.9).within_group(col.asc())


class _Scope:
    """The filters every query in this endpoint shares."""

    def __init__(
        self,
        since: datetime,
        until: datetime,
        school_id: str | None,
        exclude_internal: bool,
    ) -> None:
        self.since = since
        self.until = until
        self.school_id = school_id
        self.exclude_internal = exclude_internal

    @property
    def days(self) -> float:
        return max((self.until - self.since).total_seconds() / 86400.0, 1e-9)

    def filters(self) -> list[Any]:
        out: list[Any] = [
            LLMCall.created_at >= self.since,
            LLMCall.created_at <= self.until,
            LLMCall.function.notin_(_EXCLUDED_FUNCTIONS),
        ]
        if self.school_id == INTERNAL_SCHOOL_SENTINEL:
            out.append(LLMCall.school_id.is_(None))
        elif self.school_id:
            out.append(LLMCall.school_id == self.school_id)
        elif self.exclude_internal:
            # school_id IS NULL is founder/admin/test traffic. It looks
            # like a school's usage and would inflate every per-student
            # figure on the page.
            out.append(LLMCall.school_id.isnot(None))
        return out

    def apply(self, stmt: Select[Any]) -> Select[Any]:
        return stmt.where(*self.filters())


async def _resolve_window(
    db: AsyncSession, days: int | None,
) -> tuple[datetime, datetime, str, str | None]:
    """The window to measure over.

    Defaults to "since the model changed" rather than a fixed lookback,
    and derives that date from the first real Opus 5.5 call instead of a
    hardcoded one — the commit landed 2026-10-28 but the rollout was
    observed from 2026-11-04, and a window that straddles the switch
    averages two different pricing regimes into one meaningless number.
    """
    until = datetime.now(UTC)
    if days is not None:
        return until - timedelta(days=days), until, "fixed_days", None

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
        return until - timedelta(days=30), until, "no_cutover_found", None
    return cutover, until, "model_cutover", settings.llm_model_opus


def _submission_join(stmt: Select[Any]) -> Select[Any]:
    return stmt.join(Submission, Submission.id == LLMCall.submission_id).join(
        Assignment, Assignment.id == Submission.assignment_id,
    )


async def _submission_units(db: AsyncSession, scope: _Scope) -> list[dict[str, Any]]:
    """Cost of one submission, by assignment type.

    Cost is summed per submission FIRST and then aggregated, so the
    headline is "what one homework costs", not "what one call costs".
    The median leads: a student who photographs forty pages produces one
    very expensive call that should not set our rate card.
    """
    per_submission = scope.apply(
        _submission_join(
            select(
                LLMCall.submission_id.label("sub"),
                Assignment.type.label("kind"),
                func.sum(LLMCall.cost_usd).label("cost"),
            ),
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
    out: list[dict[str, Any]] = []
    for kind in _SUBMISSION_KINDS:
        r = by_kind.get(kind)
        out.append(
            {
                "kind": f"submission:{kind}",
                "label": kind,
                "denominator": "per student per submission",
                "n": int(r.n) if r else 0,
                "cost_median": as_float(r.median) if r else None,
                "cost_mean": as_float(r.mean) if r else None,
                "cost_p90": as_float(r.p90) if r else None,
                "cost_total": as_float(r.total) if r else 0.0,
            },
        )
    return out



# MEAN, not median. These columns reconstruct a COST: the repriced figure
# is `calls_per_unit x cost(profile)`, and only the mean satisfies
# `sum = mean x count`. A median profile understates every right-skewed
# distribution — and token counts here are explicitly skewed (one student
# photographs forty pages). Worse, the four medians are taken
# INDEPENDENTLY, so a group where fewer than half the calls hit cache has
# `median(cache_read_tokens) = 0` and the repriced figure drops the
# cache-read term that the recorded cost definitely includes.
#
# The median still leads for the DISPLAYED unit cost (_submission_units),
# where resisting one freak submission is exactly what we want. Different
# statistic, different job.
_PROFILE_COLS = (
    func.count().label("calls"),
    func.sum(LLMCall.cost_usd).label("cost"),
    func.avg(LLMCall.input_tokens).label("avg_in"),
    func.avg(LLMCall.output_tokens).label("avg_out"),
    func.avg(LLMCall.cache_read_tokens).label("avg_cread"),
    func.avg(LLMCall.cache_write_tokens).label("avg_cwrite"),
)


async def _unit_functions(
    db: AsyncSession, scope: _Scope,
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
                            *_PROFILE_COLS,
                        ),
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
                    ),
                ).group_by(Assignment.type),
            )
        ).all()
    }
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
                        *_PROFILE_COLS,
                    ).join(
                        QuestionBankGenerationJob,
                        QuestionBankGenerationJob.id == LLMCall.generation_job_id,
                    ),
                ).group_by(LLMCall.function, LLMCall.model),
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
            ),
        )
    ).scalar() or 1
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
                        *_PROFILE_COLS,
                    ).join(User, User.id == LLMCall.user_id),
                )
                .where(
                    LLMCall.submission_id.is_(None),
                    LLMCall.generation_job_id.is_(None),
                    User.role.in_(("student", "teacher")),
                )
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
                .where(
                    LLMCall.submission_id.is_(None),
                    LLMCall.generation_job_id.is_(None),
                    User.role.in_(("student", "teacher")),
                )
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



async def _generation_unit(db: AsyncSession, scope: _Scope) -> dict[str, Any]:
    """Cost of generating one teaching unit's problems.

    Grouped by the job's `unit_id`, not by job: a teacher may run several
    generation jobs while building one unit, and the thing that amortises
    over a class is the unit, not an individual job.
    """
    per_unit = scope.apply(
        select(
            QuestionBankGenerationJob.unit_id.label("unit"),
            func.sum(LLMCall.cost_usd).label("cost"),
        ).join(
            QuestionBankGenerationJob,
            QuestionBankGenerationJob.id == LLMCall.generation_job_id,
        ),
    ).group_by(QuestionBankGenerationJob.unit_id).subquery()

    r = (
        await db.execute(
            select(
                func.count().label("n"),
                _median(per_unit.c.cost).label("median"),
                func.avg(per_unit.c.cost).label("mean"),
                _p90(per_unit.c.cost).label("p90"),
                func.sum(per_unit.c.cost).label("total"),
            ),
        )
    ).one()

    return {
        "kind": "generation:unit",
        "label": "unit generation",
        "denominator": "per teaching unit",
        "n": int(r.n),
        "cost_median": as_float(r.median) if r.n else None,
        "cost_mean": as_float(r.mean) if r.n else None,
        "cost_p90": as_float(r.p90) if r.n else None,
        "cost_total": as_float(r.total),
    }


async def _residual_units(db: AsyncSession, scope: _Scope) -> list[dict[str, Any]]:
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
            .where(
                LLMCall.submission_id.is_(None),
                LLMCall.generation_job_id.is_(None),
            )
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
        LLMCall.submission_id.is_(None),
        LLMCall.generation_job_id.is_(None),
        User.role.in_(("student", "teacher")),
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
                "window_too_short": scope.days < _MIN_RESIDUAL_DAYS,
            },
        )
    return out


async def _reconciliation(db: AsyncSession, scope: _Scope) -> dict[str, Any]:
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


async def _teacher_student_ratio(
    db: AsyncSession, school_id: str | None,
) -> dict[str, Any]:
    """Measured, not assumed — it divides every teacher-side cost."""
    stmt = select(User.role, func.count().label("n")).where(
        User.role.in_(("teacher", "student")),
    )
    if school_id and school_id != INTERNAL_SCHOOL_SENTINEL:
        stmt = stmt.where(User.school_id == school_id)
    rows = (await db.execute(stmt.group_by(User.role))).all()
    counts = {r.role: int(r.n) for r in rows}
    teachers = counts.get("teacher", 0)
    students = counts.get("student", 0)
    return {
        "teachers": teachers,
        "students": students,
        "students_per_teacher": (students / teachers) if teachers else None,
    }



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

    since, until, window_basis, cutover_model = await _resolve_window(db, days)
    scope = _Scope(since, until, school_id, exclude_internal)

    units = await _submission_units(db, scope)
    units.append(await _generation_unit(db, scope))
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
            "start": since.isoformat(),
            "end": until.isoformat(),
            "days": scope.days,
            "basis": window_basis,
            "cutover_model": cutover_model,
        },
        "units": units,
        "functions_by_unit": await _unit_functions(db, scope),
        "reconciliation": await _reconciliation(db, scope),
        "teacher_student_ratio": await _teacher_student_ratio(db, school_id),
        "model_catalog": catalog(),
        "min_sample": min_sample,
    }
