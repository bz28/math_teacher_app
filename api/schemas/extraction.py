"""Shared response submodels for the Vision extraction + submission files.

These give the OpenAPI contract (and the mobile types generated from it)
real structure instead of the opaque `dict[str, Any]` / `list[dict]` the
extraction and file blobs used to serialize as. Both the student-facing
submission detail (`StudentSubmissionDetail`) and the integrity state
(`IntegrityStateResponse`) type their extraction/file fields against
these, so the wire shape has a single authoritative definition.

The shapes mirror the ACTUAL producers:
  - extraction: `INTEGRITY_EXTRACT_SCHEMA` (core/llm_schemas.py) — the
    Vision tool schema that constrains `extract_student_work`'s output,
    plus the pass-through slicers/overlays (`_slice_extraction_for_problem`,
    `apply_extraction_edits`) which preserve the top-level shape.
  - files: the `{data, media_type}` dicts written at submit time
    (school_student_practice.py). `filename` is never set by the backend
    today, but the confirm/submitted screens read it defensively
    (`file.filename ?? "Page N"`), so it stays an Optional contract field.

`extra="allow"` on the container models is defense-in-depth: the extraction
blob flows through `{**extraction, ...}` spreads in the slicer/overlay, so
even an unforeseen top-level key round-trips through the response model
instead of being silently dropped. No producer emits an extra key today
(the tool schema pins `additionalProperties: false` at every level), so
this never widens the observed wire shape — it only guarantees no loss.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ExtractionStepOut(BaseModel):
    """One work step Vision transcribed from the student's page."""

    model_config = ConfigDict(extra="allow")

    step_num: int
    # 1-based HW problem position this step belongs to. Null when the
    # extractor couldn't confidently attribute it (scratchwork,
    # cross-problem setup, notes spanning problems).
    problem_position: int | None
    latex: str
    plain_english: str


class ExtractionFinalAnswerOut(BaseModel):
    """One per-problem final answer Vision read off the page."""

    model_config = ConfigDict(extra="allow")

    problem_position: int
    answer_latex: str
    answer_plain: str


class ExtractionOut(BaseModel):
    """Full Vision extraction: ordered steps + per-problem final answers
    + overall confidence. Also used for the per-problem *slice* mirror
    (same shape, filtered to one problem) surfaced in the integrity
    state's `extraction` field."""

    model_config = ConfigDict(extra="allow")

    steps: list[ExtractionStepOut]
    final_answers: list[ExtractionFinalAnswerOut]
    # 0.0-1.0 — how confident the extractor is the read is accurate.
    # Below ~0.3 means the handwriting was effectively unreadable.
    confidence: float


class SubmissionFileOut(BaseModel):
    """One file the student turned in. `data` is raw base64 (no `data:`
    prefix); `media_type` is image/jpeg, image/png, or application/pdf."""

    model_config = ConfigDict(extra="allow")

    data: str
    media_type: str
    # Never populated by the backend today; kept Optional so the confirm/
    # submitted screens can read it (falling back to "Page N") without
    # the three clients drifting on whether the field exists.
    filename: str | None = None
