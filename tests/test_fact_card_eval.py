"""The fact-card checker on #998's recorded AI drawings, replayed at $0
(tests/harness/probes/fact_card_recorded.py): each problem written as a card
by hand, the AI's recorded drawing checked against the card alone.

Bars, fixed before the run: every drawing #998 kept (each looked at by eye:
right) passes against its card; every known-wrong version is rejected; a
drawing that leaves out a part of the card is rejected; the four story
problems #998 drew no figure for are writable as cards (context kept)."""
from __future__ import annotations

import pytest

from tests.harness.probes import fact_card_recorded as fr


def test_the_recorded_drawings_pass_against_hand_written_cards() -> None:
    r = fr.run()
    assert r["failed"] == {} and sorted(r["passed"]) == sorted(fr.RECORDED), r["failed"]
    assert sorted(r["negatives_rejected"]) == sorted(fr.NEGATIVES) and r["negatives_passed"] == []
    assert sorted(r["left_out_rejected"]) == sorted(fr.LEFT_OUT) and r["left_out_passed"] == []
    assert all(not t.startswith("refused") for t in r["stories"].values()), r["stories"]
    # The context sentence is kept for the three stories that have one.
    assert sum(t.startswith(("A ladder", "A garden", "A floor plan")) for t in r["stories"].values()) == 3


def test_the_bar_fails_when_the_checker_is_switched_off(monkeypatch: pytest.MonkeyPatch) -> None:
    import api.core.question_bank_generation as qbg

    monkeypatch.setattr(qbg, "check_construction", lambda *a, **k: [])
    monkeypatch.setattr(qbg, "unbacked_marks", lambda *a, **k: {})
    r = fr.run()
    assert sorted(r["negatives_passed"]) == sorted(fr.NEGATIVES)
