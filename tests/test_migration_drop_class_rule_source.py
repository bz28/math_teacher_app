"""dc1000098 strips `source`/`source_label` from class rules, and only that.

Runs the migration's real upgrade/downgrade against seeded `courses` rows,
one per stored rubric shape (SQL NULL and JSON null included — a JSON null
took prod down in an earlier migration), then upgrade again.
"""

from __future__ import annotations

import importlib.util
import json
import uuid
from pathlib import Path
from typing import Any

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from api.core.class_rubric import ClassRubric, class_rules
from api.database import get_engine, get_session_factory

_PATH = (
    Path(__file__).resolve().parent.parent
    / "api/alembic/versions/dc1000098_drop_class_rule_source.py"
)
_spec = importlib.util.spec_from_file_location("dc1000098", _PATH)
assert _spec and _spec.loader
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)

_SUGGESTED = {"id": "r1", "text": "Final answers need units.", "points": 5,
              "source": "suggestion", "source_label": "HW 5",
              "added_at": "2026-10-18T00:00:00+00:00"}
_SETTINGS = {"id": "r2", "text": "Label key points.", "points": None,
             "source": "settings", "source_label": None, "added_at": None}
_BARE = {"id": "r3", "text": "Show work.", "points": 2, "added_at": None}

# label -> SQL literal for courses.rubric (None = SQL NULL)
_SHAPES: dict[str, str | None] = {
    "sql_null": None,
    "json_null": "null",
    "empty": "{}",
    "no_rules": json.dumps({"rev": 2, "full_credit": "Right, with work."}),
    "rules_null": json.dumps({"rules": None, "rev": 1}),
    "rules_empty": json.dumps({"rules": [], "rev": 4}),
    "already_bare": json.dumps({"rules": [_BARE], "rev": 1}),
    "mixed": json.dumps({
        "rules": [_SUGGESTED, _SETTINGS, _BARE, "junk", None],
        "rev": 7, "partial_credit": "Slip: lose a little.",
    }),
}


def _strip(rule: Any) -> Any:
    return {k: v for k, v in rule.items() if k not in ("source", "source_label")} \
        if isinstance(rule, dict) else rule


_AFTER_UPGRADE: dict[str, Any] = {
    "sql_null": None,
    "json_null": None,
    "empty": {},
    "no_rules": json.loads(_SHAPES["no_rules"]),  # type: ignore[arg-type]
    "rules_null": {"rules": None, "rev": 1},
    "rules_empty": {"rules": [], "rev": 4},
    "already_bare": {"rules": [_BARE], "rev": 1},
    "mixed": {
        "rules": [_strip(_SUGGESTED), _strip(_SETTINGS), _BARE, "junk", None],
        "rev": 7, "partial_credit": "Slip: lose a little.",
    },
}


async def _seed() -> dict[str, uuid.UUID]:
    ids = {label: uuid.uuid4() for label in _SHAPES}
    async with get_session_factory()() as s:
        await s.execute(text("TRUNCATE TABLE courses RESTART IDENTITY CASCADE"))
        for label, literal in _SHAPES.items():
            await s.execute(
                text("INSERT INTO courses (id, name, subject, status, rubric) "
                     "VALUES (:id, :name, 'math', 'draft', CAST(:r AS json))"),
                {"id": ids[label], "name": label, "r": literal},
            )
        await s.commit()
    return ids


async def _rubrics(ids: dict[str, uuid.UUID]) -> dict[str, Any]:
    """label -> parsed rubric; SQL NULL and JSON null both read as None,
    so `_is_sql_null` tells them apart."""
    async with get_session_factory()() as s:
        rows = (await s.execute(text("SELECT id, rubric::text FROM courses"))).all()
    by_id = {cid: (None if raw is None else json.loads(raw)) for cid, raw in rows}
    return {label: by_id[cid] for label, cid in ids.items()}


async def _sql_nulls() -> set[str]:
    async with get_session_factory()() as s:
        rows = (await s.execute(text("SELECT name FROM courses WHERE rubric IS NULL"))).all()
    return {r[0] for r in rows}


async def _run(step: str) -> None:
    def go(sync_conn: Any) -> None:
        with Operations.context(MigrationContext.configure(sync_conn)):
            getattr(mig, step)()

    async with get_engine().begin() as conn:
        await conn.run_sync(go)


async def test_upgrade_downgrade_upgrade_across_every_shape() -> None:
    ids = await _seed()

    await _run("upgrade")
    assert await _rubrics(ids) == _AFTER_UPGRADE
    assert await _sql_nulls() == {"sql_null"}  # JSON null stayed JSON null

    # Idempotent: a second run changes nothing.
    await _run("upgrade")
    assert await _rubrics(ids) == _AFTER_UPGRADE

    await _run("downgrade")
    down = await _rubrics(ids)
    assert down["mixed"]["rules"][:3] == [
        {**_strip(_SUGGESTED), "source": "settings", "source_label": None},
        _SETTINGS,
        {**_BARE, "source": "settings", "source_label": None},
    ]
    assert down["mixed"]["rules"][3:] == ["junk", None]
    for label in ("sql_null", "json_null", "empty", "no_rules", "rules_null", "rules_empty"):
        assert down[label] == _AFTER_UPGRADE[label]
    assert await _sql_nulls() == {"sql_null"}

    await _run("upgrade")
    after = await _rubrics(ids)
    assert after["mixed"]["rules"][:3] == [_strip(_SUGGESTED), _strip(_SETTINGS), _BARE]
    assert after["already_bare"] == {"rules": [_BARE], "rev": 1}


async def test_migrated_rules_round_trip_through_the_editor() -> None:
    """Every migrated rule, as the GET serves it and the editor sends it
    back, validates against the request model and keeps id and date."""
    ids = await _seed()
    await _run("upgrade")
    for rubric in (await _rubrics(ids)).values():
        served = class_rules(rubric)
        sent = [{"id": r["id"], "text": r["text"], "points": r.get("points")} for r in served]
        stored = ClassRubric.model_validate({"rules": sent}).to_stored(rubric)
        assert [(r["id"], r["added_at"]) for r in stored["rules"]] == [
            (r["id"], r.get("added_at")) for r in served
        ]
        # The served rules are exactly the request model's fields.
        ClassRubric.model_validate({"rules": served})
