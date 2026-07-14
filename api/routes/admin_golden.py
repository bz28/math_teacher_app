"""Admin endpoint: the eval golden set (Generation QA).

Serves the curated regression corpus plus each case's most-recent eval outcome
so the dashboard can show live per-case pass/fail, surface regressions the
moment one flips, and let the operator curate the set (add / retire) and
request a fresh eval. The heavy per-run report stays in `HarnessRun`; each case
links to the run that last evaluated it via `last_run_id`.
"""

import uuid as uuid_lib
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.golden_case import (
    STATUS_FAIL,
    STATUS_PASS,
    STATUS_PENDING,
    GoldenCase,
)

router = APIRouter()


def _is_regression(r: GoldenCase) -> bool:
    """A case that was passing and now fails — the alarm the console exists for."""
    return r.prev_status == STATUS_PASS and r.last_status == STATUS_FAIL


def _serialize(r: GoldenCase) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "probe": r.probe,
        "name": r.name,
        "constraint": r.constraint,
        "adversarial": r.adversarial,
        "expected_shapes": r.expected_shapes or [],
        "rationale": r.rationale,
        "last_status": r.last_status,
        "is_regression": _is_regression(r),
        "last_run_at": r.last_run_at.isoformat() if r.last_run_at else None,
        "last_model": r.last_model,
        "last_run_id": str(r.last_run_id) if r.last_run_id else None,
        "last_output": r.last_output,
        "rerun_requested": r.rerun_requested_at is not None,
        "retired": r.retired,
    }


@router.get("/golden-set")
async def golden_set(
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Every golden case + the health tiles the console leads with."""
    rows = list(
        (
            await db.execute(select(GoldenCase).order_by(GoldenCase.name))
        ).scalars().all()
    )
    active = [r for r in rows if not r.retired]

    evaluated = [r for r in active if r.last_status != STATUS_PENDING]
    passing = [r for r in evaluated if r.last_status == STATUS_PASS]
    regressions = [r for r in active if _is_regression(r)]

    # "Last eval run" = the most recent eval that touched any active case.
    run_at: datetime | None = None
    run_model: str | None = None
    for r in active:
        if r.last_run_at and (run_at is None or r.last_run_at > run_at):
            run_at, run_model = r.last_run_at, r.last_model

    return {
        "cases": [_serialize(r) for r in rows],
        "stats": {
            "set_size": len(active),
            "last_run": {
                "at": run_at.isoformat() if run_at else None,
                "model": run_model,
            },
            "pass_rate": {"passing": len(passing), "evaluated": len(evaluated)},
            "regressions": len(regressions),
        },
    }


class GoldenCaseCreate(BaseModel):
    probe: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    constraint: str = Field(min_length=1)
    adversarial: bool = False
    expected_shapes: list[str] = Field(default_factory=list)
    rationale: str | None = None


@router.post("/golden-set", status_code=status.HTTP_201_CREATED)
async def add_golden_case(
    payload: GoldenCaseCreate,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Add a golden case. It starts `pending` until the next corpus run evaluates it."""
    dup = (
        await db.execute(
            select(GoldenCase).where(
                GoldenCase.probe == payload.probe,
                GoldenCase.name == payload.name,
            ),
        )
    ).scalar_one_or_none()
    if dup is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A golden case with this probe and name already exists.",
        )
    row = GoldenCase(
        probe=payload.probe,
        name=payload.name,
        constraint=payload.constraint,
        adversarial=payload.adversarial,
        expected_shapes=payload.expected_shapes,
        rationale=payload.rationale,
        last_status=STATUS_PENDING,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _serialize(row)


async def _get_case(db: AsyncSession, case_id: str) -> GoldenCase:
    try:
        cid = uuid_lib.UUID(case_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not found",
        ) from e
    row = (
        await db.execute(select(GoldenCase).where(GoldenCase.id == cid))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return row


class RetirePayload(BaseModel):
    retired: bool = True


@router.patch("/golden-set/{case_id}/retire")
async def retire_golden_case(
    case_id: str,
    payload: RetirePayload,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Retire (or restore) a case — keeps its history, drops it from the tiles."""
    row = await _get_case(db, case_id)
    row.retired = payload.retired
    await db.commit()
    await db.refresh(row)
    return _serialize(row)


class RerunPayload(BaseModel):
    # Empty → request a re-eval of every active case.
    ids: list[str] = Field(default_factory=list)


@router.post("/golden-set/rerun")
async def rerun_golden_eval(
    payload: RerunPayload,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Flag cases for a fresh eval. The autonomous harness picks these up on its
    next corpus run (it re-runs the whole corpus and upserts fresh results,
    clearing the flag) — this records the operator's intent without wiping the
    currently-shown verdict."""
    now = datetime.now(UTC)
    stmt = update(GoldenCase).values(rerun_requested_at=now).where(
        GoldenCase.retired.is_(False),
    )
    if payload.ids:
        try:
            ids = [uuid_lib.UUID(i) for i in payload.ids]
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Bad id",
            ) from e
        stmt = stmt.where(GoldenCase.id.in_(ids))
    result = await db.execute(stmt)
    await db.commit()
    return {"requested": int(getattr(result, "rowcount", 0) or 0)}
