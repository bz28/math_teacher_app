"""Pure-logic tests for Channel A's CI-side glue (no network, no app).

Covers the deterministic defect→proposal conversion, the crucial id-stability
contract (a recurring defect must NOT re-file every run as its count grows), and
the watermark round-trip. `fetch_defects` is a thin httpx wrapper exercised by
the workflow itself.
"""

from __future__ import annotations

from tests.harness.improver.llm_defects import (
    defects_to_proposals,
    read_watermark,
    write_watermark,
)


def _corrupt(count: int, fn: str = "decompose") -> dict[str, object]:
    return {"function": fn, "kind": "corrupt", "count": count,
            "sample_call_id": "abc-123", "corruption_chars": ["formfeed(\\f)"]}


def test_corrupt_and_failed_conversion() -> None:
    props = defects_to_proposals([
        _corrupt(5),
        {"function": "grade", "kind": "failed", "count": 2, "sample_call_id": "def-456"},
    ])
    by_fn = {p.surface_key: p for p in props}
    corrupt = by_fn["llm:decompose"]
    assert corrupt.category == "bug" and corrupt.severity == "high" and corrupt.confidence == 0.9
    assert "_normalize_arrays" in corrupt.change          # points at the real fix site
    assert "5 production" in corrupt.rationale            # count lives in the rationale
    failed = by_fn["llm:grade"]
    assert failed.severity == "medium" and failed.confidence == 0.6


def test_proposal_id_is_stable_as_count_grows() -> None:
    # The whole point of grouping: the SAME recurring defect must keep the SAME
    # id across runs (so dedupe suppresses it), even as its occurrence count rises.
    one = defects_to_proposals([_corrupt(1)])[0]
    later = defects_to_proposals([_corrupt(900)])[0]
    assert one.id == later.id
    # ...but a different function is a genuinely different proposal.
    other = defects_to_proposals([_corrupt(1, fn="solve")])[0]
    assert other.id != one.id


def test_empty_defects_yield_no_proposals() -> None:
    assert defects_to_proposals([]) == []


def test_watermark_roundtrip(tmp_path) -> None:  # type: ignore[no-untyped-def]
    assert read_watermark(tmp_path) is None          # first run
    write_watermark(tmp_path, "2026-06-06T12:00:00+00:00|uuid-1")
    assert read_watermark(tmp_path) == "2026-06-06T12:00:00+00:00|uuid-1"
