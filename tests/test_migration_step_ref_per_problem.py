"""dd1000099 renumbers stored deduction `step_ref`s from the homework-wide
`step_num` to the step's 1-based place in its problem.

Runs the migration's real upgrade/downgrade against seeded grade rows in
every stored shape (SQL NULL and JSON null included — a JSON null took prod
down in an earlier migration), and checks the rewritten refs land on the
same step the teacher review payload lists at that place.
"""

from __future__ import annotations

import importlib.util
import json
import uuid
from pathlib import Path
from typing import Any

from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import AsyncClient
from sqlalchemy import text

from api.database import get_engine, get_session_factory
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw

_PATH = (
    Path(__file__).resolve().parent.parent
    / "api/alembic/versions/dd1000099_step_ref_per_problem.py"
)
_spec = importlib.util.spec_from_file_location("dd1000099", _PATH)
assert _spec and _spec.loader
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)

# Prod shape: step_num counts across the homework. Problem 2's steps are
# 4..7; the student cleared step 5, and step 6 has no text, so the review
# page lists [4, 7] and step 7 is problem 2's 2nd step.
_EXTRACTION = {
    "steps": [
        {"step_num": 1, "problem_position": 1, "latex": "a", "plain_english": ""},
        {"step_num": 2, "problem_position": 1, "latex": "b", "plain_english": ""},
        {"step_num": 3, "problem_position": None, "latex": "scratch", "plain_english": ""},
        {"step_num": 4, "problem_position": 2, "latex": "c", "plain_english": ""},
        {"step_num": 5, "problem_position": 2, "latex": "misread", "plain_english": ""},
        {"step_num": 6, "problem_position": 2, "latex": "", "plain_english": ""},
        {"step_num": 7, "problem_position": 2, "latex": "d", "plain_english": ""},
    ],
    "final_answers": [],
}
_EDITS = {"2:5": "  "}


def _ded(ref: Any) -> dict[str, Any]:
    return {"points_off": 5, "reason": "r", "step_ref": ref, "rule_id": None}


def _ledgers(p1: list[Any], p2: list[Any], ids: list[str]) -> tuple[Any, Any]:
    ai = {"grades": [
        {"problem_position": 1, "deductions": [_ded(r) for r in p1]},
        {"problem_position": 2, "deductions": [_ded(r) for r in p2]},
        {"problem_position": 2},  # no ledger
        {"problem_position": None, "deductions": [_ded(7)]},
    ], "problem_percents": {}}
    b = [
        {"problem_id": ids[0], "deductions": [_ded(r) for r in p1]},
        {"problem_id": ids[1], "deductions": [_ded(r) for r in p2]},
        {"problem_id": "not-on-this-hw", "deductions": [_ded(7)]},
        {"problem_id": ids[1], "deductions": None},
    ]
    return ai, b


async def _run(step: str) -> None:
    def go(sync_conn: Any) -> None:
        with Operations.context(MigrationContext.configure(sync_conn)):
            getattr(mig, step)()

    async with get_engine().begin() as conn:
        await conn.run_sync(go)


async def _grade(sub_id: uuid.UUID) -> dict[str, Any]:
    async with get_session_factory()() as s:
        row = (await s.execute(text(
            "SELECT ai_breakdown::text, breakdown::text, published_breakdown::text "
            "FROM submission_grades WHERE submission_id = :id"
        ), {"id": sub_id})).one()
    return {k: (None if v is None else json.loads(v)) for k, v in zip(("ai", "b", "pb"), row)}


async def test_upgrade_renumbers_then_downgrade_restores(client: AsyncClient) -> None:
    world = await _seed_hw(n_submissions=3, n_problems=2)
    ids = world["bank_item_ids"]
    full, nulls, no_extraction = world["submission_ids"]
    # 7 → 2nd listed step; 4 → 1st; 5 (cleared) and 99 match nothing;
    # null and a non-int stay as they are. Problem 1 is the identity.
    ai, b = _ledgers([1, 2], [7, 4, 5, 99, None, "x"], ids)
    async with get_session_factory()() as s:
        for sub_id, ex, ed in (
            (full, _EXTRACTION, _EDITS), (nulls, _EXTRACTION, None), (no_extraction, None, None),
        ):
            await s.execute(text(
                "UPDATE submissions SET extraction = CAST(:ex AS json), "
                "extraction_edits = CAST(:ed AS json) WHERE id = :id"
            ), {"id": sub_id, "ex": None if ex is None else json.dumps(ex),
                "ed": None if ed is None else json.dumps(ed)})
        await s.execute(text(
            "INSERT INTO submission_grades (id, submission_id, ai_breakdown, breakdown, published_breakdown) "
            "VALUES (:g, :s, CAST(:ai AS json), CAST(:b AS json), CAST(:b AS json))"
        ), {"g": uuid.uuid4(), "s": full, "ai": json.dumps(ai), "b": json.dumps(b)})
        # SQL NULL ai_breakdown, JSON null breakdown, SQL NULL published.
        await s.execute(text(
            "INSERT INTO submission_grades (id, submission_id, ai_breakdown, breakdown) "
            "VALUES (:g, :s, NULL, CAST('null' AS json))"
        ), {"g": uuid.uuid4(), "s": nulls})
        await s.execute(text(
            "INSERT INTO submission_grades (id, submission_id, ai_breakdown, breakdown) "
            "VALUES (:g, :s, CAST(:ai AS json), CAST(:b AS json))"
        ), {"g": uuid.uuid4(), "s": no_extraction, "ai": json.dumps(ai), "b": json.dumps(b)})
        await s.commit()

    await _run("upgrade")
    after = await _grade(full)
    want_p2 = [2, 1, None, None, None, "x"]
    assert [d["step_ref"] for d in after["ai"]["grades"][0]["deductions"]] == [1, 2]
    assert [d["step_ref"] for d in after["ai"]["grades"][1]["deductions"]] == want_p2
    assert after["ai"]["grades"][2:] == ai["grades"][2:]
    for col in ("b", "pb"):
        assert [d["step_ref"] for d in after[col][0]["deductions"]] == [1, 2]
        assert [d["step_ref"] for d in after[col][1]["deductions"]] == want_p2
        assert after[col][2:] == b[2:]  # off-homework id and null ledger untouched
    assert after["ai"]["grades"][1]["deductions"][0]["points_off"] == 5
    assert await _grade(nulls) == {"ai": None, "b": None, "pb": None}
    assert await _grade(no_extraction) == {"ai": ai, "b": b, "pb": None}

    # The migrated ref is the row the review page tints.
    r = await client.get(f"/v1/teacher/submissions/{full}", headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    steps = next(p for p in r.json()["problems"] if p["bank_item_id"] == ids[1])["student_steps"]
    assert [s["latex"] for s in steps] == ["c", "d"]
    assert steps[2 - 1]["latex"] == "d"  # old step_ref 7

    await _run("downgrade")
    down = await _grade(full)
    assert [d["step_ref"] for d in down["ai"]["grades"][1]["deductions"]] == [7, 4, None, None, None, "x"]
    assert [d["step_ref"] for d in down["b"][0]["deductions"]] == [1, 2]


def test_odd_shapes_are_left_alone() -> None:
    steps = mig.step_nums_by_position(_EXTRACTION, _EDITS)
    assert steps == {1: [1, 2], 2: [4, 7]}
    assert mig.step_nums_by_position(None, None) == {}
    assert mig.step_nums_by_position({"steps": None}, "junk") == {}
    for ai in (None, [], {"grades": None}, {"grades": ["junk", None, {"problem_position": True}]}):
        assert not mig.remap_ai_breakdown(ai, steps, mig.to_index)
    for b in (None, {}, ["junk", None, {"problem_id": None, "deductions": [_ded(7)]}]):
        assert not mig.remap_breakdown(b, steps, {"p": 2}, mig.to_index)
