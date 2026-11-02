r"""dd1000099 repairs eaten LaTeX backslashes in bank items, and only there.

Runs the real migration with alembic against a scratch database: upgrade to
the revision before it, seed every shape the JSON columns hold in prod (SQL
NULL, JSON null, empty list, list of strings, list of objects) next to
corrupt rows, then upgrade, downgrade, upgrade. A JSON-null value took prod
down in an earlier data migration (ct1000089), so every shape is seeded.
Rows with no corruption must not be written at all, which `xmin` (the
writing transaction's id) proves.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import asyncpg
import pytest
from sqlalchemy.engine import make_url

REPO = Path(__file__).resolve().parents[1]
PREV, REV = "dc1000098", "dd1000099"

FRAC = "\f" + "rac"  # what `\frac` became after the bad decode


def _alembic(url: str, *args: str) -> None:
    env = {**os.environ, "DATABASE_URL": url}
    env.setdefault("CLAUDE_API_KEY", "dummy")
    subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=REPO, env=env, check=True,
        capture_output=True,
    )


@pytest.fixture
async def scratch() -> AsyncIterator[tuple[str, str]]:
    """(sqlalchemy url, asyncpg dsn) of a fresh database, dropped afterwards."""
    base = make_url(os.environ["DATABASE_URL"])
    name = f"mig_latex_{uuid.uuid4().hex[:10]}"
    admin_dsn = base.set(drivername="postgresql").render_as_string(hide_password=False)
    admin = await asyncpg.connect(admin_dsn)
    await admin.execute(f'CREATE DATABASE "{name}"')
    try:
        url = base.set(database=name)
        yield (
            url.render_as_string(hide_password=False),
            url.set(drivername="postgresql").render_as_string(hide_password=False),
        )
    finally:
        await admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        await admin.close()


# key -> (question, final_answer, solution_steps, distractors, chat_messages)
# JSON values are Python objects; "SQL NULL" means a real NULL, None a JSON null.
SQL_NULL = object()
ROWS: dict[str, tuple[str, str, Any, Any, Any]] = {
    "corrupt": (
        "Simplify $2\beta$",  # backspace + "eta"
        f"${FRAC}{{1}}{{2}}$",
        [{"title": "Divide", "description": f"${FRAC}{{6}}{{3}}$\nthen $x \rightarrow 2$"}],
        [f"${FRAC}{{3}}{{4}}$", "$\rho$", "$\vec{v}$"],
        [{"role": "ai", "text": "ok", "proposal": {"question": f"${FRAC}{{1}}{{3}}$"}}],
    ),
    "json_null": ("Q", "4", None, None, []),
    "sql_null": ("Q", "4", SQL_NULL, SQL_NULL, []),
    "empty": ("Q", "4", [], [], []),
    "clean_strings": ("Q $\\frac{1}{2}$", "$\\frac{1}{2}$", [], ["$\\frac{3}{4}$", "5"], []),
    "clean_objects": (
        "Q", "4",
        [{"title": "t", "description": "line\r\nbreak $\\beta$"}], ["1", "2", "3"],
        [{"role": "teacher", "text": "$\\rho$"}],
    ),
}


def _json(v: Any) -> str | None:
    return None if v is SQL_NULL else json.dumps(v)


async def _seed(dsn: str) -> dict[str, uuid.UUID]:
    conn = await asyncpg.connect(dsn)
    try:
        user, course, unit, hw = (uuid.uuid4() for _ in range(4))
        await conn.execute(
            "INSERT INTO users (id, email, password_hash, grade_level, role, is_active,"
            " failed_login_attempts) VALUES ($1, 'a@x.edu', 'x', 12, 'admin', true, 0)",
            user,
        )
        await conn.execute("INSERT INTO courses (id, name) VALUES ($1, 'C')", course)
        await conn.execute(
            "INSERT INTO units (id, course_id, name) VALUES ($1, $2, 'U')", unit, course,
        )
        await conn.execute(
            "INSERT INTO assignments (id, course_id, unit_ids, teacher_id, title, type)"
            " VALUES ($1, $2, ARRAY[$3]::uuid[], $4, 'HW', 'homework')",
            hw, course, unit, user,
        )
        ids: dict[str, uuid.UUID] = {}
        for key, (question, answer, steps, distractors, chat) in ROWS.items():
            ids[key] = uuid.uuid4()
            await conn.execute(
                "INSERT INTO question_bank_items (id, course_id, unit_id,"
                " originating_assignment_id, title, question, final_answer, solution_steps,"
                " distractors, chat_messages, previous_solution_steps)"
                " VALUES ($1, $2, $3, $4, $5, $6, $7, $8::json, $9::json, $10::json, $8::json)",
                ids[key], course, unit, hw, key, question, answer,
                _json(steps), _json(distractors), _json(chat),
            )
        return ids
    finally:
        await conn.close()


async def _snapshot(dsn: str) -> dict[str, dict[str, Any]]:
    conn = await asyncpg.connect(dsn)
    try:
        rows = await conn.fetch(
            "SELECT title, question, final_answer, solution_steps::text AS steps,"
            " distractors::text AS distractors, chat_messages::text AS chat,"
            " previous_solution_steps::text AS prev_steps, xmin::text AS xmin"
            " FROM question_bank_items"
        )
        return {r["title"]: dict(r) for r in rows}
    finally:
        await conn.close()


async def test_upgrade_downgrade_upgrade(scratch: tuple[str, str]) -> None:
    url, dsn = scratch
    _alembic(url, "upgrade", PREV)
    await _seed(dsn)
    before = await _snapshot(dsn)

    _alembic(url, "upgrade", REV)
    after = await _snapshot(dsn)

    fixed = after["corrupt"]
    assert fixed["question"] == r"Simplify $2\beta$"
    assert fixed["final_answer"] == r"$\frac{1}{2}$"
    assert json.loads(fixed["distractors"]) == [r"$\frac{3}{4}$", r"$\rho$", r"$\vec{v}$"]
    steps = [{"title": "Divide", "description": "$\\frac{6}{3}$\nthen $x \\rightarrow 2$"}]
    assert json.loads(fixed["steps"]) == steps
    assert json.loads(fixed["prev_steps"]) == steps
    assert json.loads(fixed["chat"])[0]["proposal"]["question"] == r"$\frac{1}{3}$"

    # Every other row is byte-for-byte unchanged and was never written.
    for key in ROWS:
        if key != "corrupt":
            assert after[key] == before[key], key
    assert after["json_null"]["distractors"] == "null"
    assert after["sql_null"]["distractors"] is None

    _alembic(url, "downgrade", PREV)  # no-op: leaves the repaired values
    assert await _snapshot(dsn) == after

    _alembic(url, "upgrade", REV)  # idempotent: nothing left to write
    assert await _snapshot(dsn) == after
