"""Round-trip tests for the shared extraction/file response submodels.

The contract switch from `dict[str, Any]` / `list[dict]` to the typed
`ExtractionOut` / `SubmissionFileOut` (api/schemas/extraction.py) must not
drop any field the producers write. These tests assert:

- A producer-shaped extraction (matching INTEGRITY_EXTRACT_SCHEMA) survives
  validation + serialization byte-for-byte.
- An extraction carrying UNFORESEEN extra keys (top-level and per-step)
  round-trips them intact — `extra="allow"` is the no-data-loss guarantee
  the pass-through slicer/overlay rely on (they spread `{**extraction}`).
- A submission file round-trips, `filename` defaults to None (never set by
  the backend today), and extra keys survive.
"""

from __future__ import annotations

from api.schemas.extraction import ExtractionOut, SubmissionFileOut


def test_producer_shaped_extraction_round_trips_exactly() -> None:
    # Exactly what extract_student_work returns (INTEGRITY_EXTRACT_SCHEMA).
    raw = {
        "steps": [
            {"step_num": 1, "problem_position": 1, "latex": "x = 5", "plain_english": "solve for x"},
            {"step_num": 2, "problem_position": None, "latex": "", "plain_english": "scratch"},
        ],
        "final_answers": [
            {"problem_position": 1, "answer_latex": "x=5", "answer_plain": "five"},
        ],
        "confidence": 0.92,
    }
    dumped = ExtractionOut.model_validate(raw).model_dump()
    assert dumped == raw


def test_extraction_preserves_unforeseen_extra_keys() -> None:
    # A future writer stashing extra keys must NOT have them dropped by the
    # stricter typing — extra="allow" round-trips them at every level.
    raw = {
        "steps": [
            {
                "step_num": 1,
                "problem_position": 1,
                "latex": "x=5",
                "plain_english": "solve",
                "confidence_per_step": 0.8,  # unforeseen per-step key
            },
        ],
        "final_answers": [
            {"problem_position": 1, "answer_latex": "5", "answer_plain": "five", "units": "cm"},
        ],
        "confidence": 0.5,
        "model_version": "vision-2026-07",  # unforeseen top-level key
    }
    dumped = ExtractionOut.model_validate(raw).model_dump()
    assert dumped["model_version"] == "vision-2026-07"
    assert dumped["steps"][0]["confidence_per_step"] == 0.8
    assert dumped["final_answers"][0]["units"] == "cm"
    # Nothing dropped: the full input is a subset of the output.
    assert dumped == raw


def test_submission_file_round_trips_and_filename_defaults_none() -> None:
    # Exactly what submit writes: {data, media_type}, no filename.
    raw = {"data": "aGVsbG8=", "media_type": "image/jpeg"}
    dumped = SubmissionFileOut.model_validate(raw).model_dump()
    assert dumped["data"] == "aGVsbG8="
    assert dumped["media_type"] == "image/jpeg"
    assert dumped["filename"] is None


def test_submission_file_preserves_filename_and_extra_keys() -> None:
    raw = {
        "data": "aGVsbG8=",
        "media_type": "application/pdf",
        "filename": "page1.pdf",
        "page_count": 3,  # unforeseen key
    }
    dumped = SubmissionFileOut.model_validate(raw).model_dump()
    assert dumped["filename"] == "page1.pdf"
    assert dumped["page_count"] == 3
