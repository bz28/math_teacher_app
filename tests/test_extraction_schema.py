"""Round-trip tests for the shared extraction/file response submodels.

The contract switch from `dict[str, Any]` / `list[dict]` to the typed
`ExtractionOut` / `SubmissionFileOut` (api/schemas/extraction.py) must not
drop any field the producers write. These tests assert:

- A producer-shaped extraction (matching INTEGRITY_EXTRACT_SCHEMA) survives
  validation + serialization byte-for-byte.
- An extraction carrying UNFORESEEN extra keys (top-level and per-step)
  round-trips them intact — `extra="allow"` is the no-data-loss guarantee
  the pass-through slicer/overlay rely on (they spread `{**extraction}`).
- A submission file is served as a URL (never its bytes), and `filename`
  defaults to None (never set by the backend today).
"""

from __future__ import annotations

from api.core import photo_store
from api.schemas.extraction import ExtractionOut, SubmissionFileOut


def test_producer_shaped_extraction_round_trips_exactly() -> None:
    # Exactly what extract_student_work returns (INTEGRITY_EXTRACT_SCHEMA).
    raw = {
        "steps": [
            {
                "step_num": 1,
                "problem_position": 1,
                "latex": "x = 5",
                "plain_english": "solve for x",
                "page_index": 1,
            },
            {
                "step_num": 2,
                "problem_position": None,
                "latex": "",
                "plain_english": "scratch",
                "page_index": None,
            },
        ],
        "final_answers": [
            {
                "problem_position": 1,
                "answer_latex": "x=5",
                "answer_plain": "five",
                "page_index": 2,
            },
        ],
        "confidence": 0.92,
    }
    dumped = ExtractionOut.model_validate(raw).model_dump()
    # `visual_work` is the one key the contract ADDS: rows extracted
    # before the drawings channel existed serialize with an empty list
    # so every client sees a stable shape. Everything else is exact.
    assert dumped == {**raw, "visual_work": []}


def test_extraction_preserves_unforeseen_extra_keys() -> None:
    # A future writer stashing extra keys must NOT have them dropped by the
    # stricter typing — extra="allow" round-trips them at every level.
    raw = {
        "steps": [
            {
                "step_num": 1,
                "problem_position": 1,
                "page_index": 1,
                "latex": "x=5",
                "plain_english": "solve",
                "confidence_per_step": 0.8,  # unforeseen per-step key
            },
        ],
        "final_answers": [
            {
                "problem_position": 1,
                "answer_latex": "5",
                "answer_plain": "five",
                "page_index": 1,
                "units": "cm",
            },
        ],
        "confidence": 0.5,
        "model_version": "vision-2026-07",  # unforeseen top-level key
    }
    dumped = ExtractionOut.model_validate(raw).model_dump()
    assert dumped["model_version"] == "vision-2026-07"
    assert dumped["steps"][0]["confidence_per_step"] == 0.8
    assert dumped["final_answers"][0]["units"] == "cm"
    # Nothing dropped: the full input is a subset of the output.
    assert dumped == {**raw, "visual_work": []}


def test_submission_file_is_a_url_never_the_bytes() -> None:
    # Exactly what submit stores now: {key, media_type}, no filename.
    out = photo_store.page_out({"key": "submissions/abc/0123abcd.jpg", "media_type": "image/jpeg"})
    dumped = SubmissionFileOut.model_validate(out).model_dump()
    assert dumped["url"]
    assert "data" not in dumped
    assert dumped["media_type"] == "image/jpeg"
    assert dumped["id"] == "0123abcd"
    assert dumped["expires_in"] == photo_store.PRESIGN_SECONDS
    assert dumped["filename"] is None


def test_inline_submission_file_is_served_as_a_data_url_with_its_filename() -> None:
    # INLINE: a row the backfill hasn't moved yet.
    out = photo_store.page_out({"data": "aGVsbG8=", "media_type": "application/pdf", "filename": "page1.pdf"})
    dumped = SubmissionFileOut.model_validate(out).model_dump()
    assert dumped["url"] == "data:application/pdf;base64,aGVsbG8="
    assert dumped["filename"] == "page1.pdf"
    assert dumped["id"] is None
    assert dumped["expires_in"] is None
