"""Alembic must have exactly one head.

Two open PRs that each chain a migration onto the same parent both pass
CI on their own, and only collide once both are on main. Then
`alembic upgrade head` refuses to run and the deploy fails. This test
catches it in the PR that merges second, which is the one that has to
re-point its down_revision.
"""

from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

ROOT = Path(__file__).resolve().parent.parent


def test_alembic_has_a_single_head() -> None:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "api" / "alembic"))
    heads = ScriptDirectory.from_config(config).get_heads()
    assert len(heads) == 1, (
        f"alembic has {len(heads)} heads {sorted(heads)} — re-point the newer "
        "migration's down_revision at the other head"
    )
