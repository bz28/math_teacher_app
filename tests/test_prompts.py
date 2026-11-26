"""Versioned prompt files: content-hash guard + byte-identical renders."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from api.core.prompts import PROMPT_VERSIONS, load_prompt, load_prompt_map, prompt_version
from tests.prompt_render_samples import render_samples

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "api" / "core" / "prompts"
HASHES = json.loads((PROMPTS_DIR / "hashes.json").read_text())
SNAPSHOTS = json.loads((Path(__file__).parent / "data" / "prompt_snapshots.json").read_text())


def _prompt_files() -> set[str]:
    return {p.name for p in PROMPTS_DIR.iterdir() if p.suffix in {".txt", ".json"}} - {"hashes.json"}


def test_every_registered_version_has_exactly_one_file() -> None:
    expected = set()
    for name, v in PROMPT_VERSIONS.items():
        found = [f for f in _prompt_files() if f.startswith(f"{name}.v{v}.")]
        assert len(found) == 1, f"{name}@v{v}: expected one file, found {found}"
        expected |= set(found)
    assert _prompt_files() == expected, "prompt files not in PROMPT_VERSIONS (delete old versions)"


def test_prompt_bytes_match_pinned_hash() -> None:
    """Editing a prompt's text without bumping its version fails here."""
    assert set(HASHES) == _prompt_files()
    for name, digest in HASHES.items():
        actual = hashlib.sha256((PROMPTS_DIR / name).read_bytes()).hexdigest()
        assert actual == digest, (
            f"{name} changed: add a new version file and bump PROMPT_VERSIONS, "
            "then update hashes.json"
        )


@pytest.mark.parametrize("key", sorted(SNAPSHOTS))
def test_rendered_prompt_is_byte_identical_to_pre_move_snapshot(key: str) -> None:
    assert render_samples()[key] == SNAPSHOTS[key]


def test_snapshot_covers_every_render_sample() -> None:
    assert set(render_samples()) == set(SNAPSHOTS)


def test_inline_answer_equivalence_prompt_unchanged() -> None:
    # Was an inline literal in integrity_pipeline; hash taken from the old source.
    text = load_prompt("integrity_answer_equivalence_system")
    expected = "2f4096fd707ea835d2aee8e0300eb6384c1d2e77e2b8dcd979e31305f4e22862"
    assert hashlib.sha256(text.encode()).hexdigest() == expected


def test_loaders_and_version_ids() -> None:
    assert prompt_version("grading_system") == f"grading_system@v{PROMPT_VERSIONS['grading_system']}"
    assert isinstance(load_prompt_map("integrity_posture_fragments"), dict)
    with pytest.raises(KeyError):
        prompt_version("nope")
