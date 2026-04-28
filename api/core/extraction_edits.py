"""Apply student-supplied corrections (Submission.extraction_edits) over
the immutable Vision extraction (Submission.extraction).

The student fixes OCR misreads on the post-submit confirm screen before
AI grading runs. Their edits are stored as a sparse {key: text} map; we
overlay them at grading time so the AI sees what the student claims they
wrote, while keeping the original Vision read on the row for the teacher
review page to surface as evidence.

Edit key format:
    "{problem_position}:{step_num}"  → step edit (replaces plain_english,
                                       clears latex)
    "{problem_position}:final"       → final-answer edit (replaces
                                       answer_plain, clears answer_latex)

Empty-string edits are treated as deletions of that row in the resulting
overlaid extraction. The original Vision-read step / answer is preserved
in `extraction_edits_meta` so callers (notably the teacher-review payload)
can render a "view original" disclosure without re-querying the raw blob.
"""

from __future__ import annotations

from typing import Any


def _step_key(position: int | None, step_num: int | None) -> str | None:
    if not isinstance(position, int) or isinstance(position, bool):
        return None
    if not isinstance(step_num, int) or isinstance(step_num, bool):
        return None
    return f"{position}:{step_num}"


def _final_key(position: int | None) -> str | None:
    if not isinstance(position, int) or isinstance(position, bool):
        return None
    return f"{position}:final"


def apply_extraction_edits(
    extraction: dict[str, Any] | None,
    edits: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Return a new extraction dict with `edits` overlaid.

    - `extraction` is the original Vision output (`steps`,
      `final_answers`, `confidence`, ...).
    - `edits` is the sparse map persisted in Submission.extraction_edits.
      Keys not matching a real step/final are ignored — the confirm
      endpoint validates on write, but this overlay is defensive against
      stale keys (e.g. extraction shape changed after edit was stored).

    Empty-string edits drop the corresponding row from the overlay so a
    student who cleared a misread step doesn't leave a phantom step in
    the grader's view.

    The returned dict preserves the top-level shape; callers (grading,
    integrity, teacher review) use it interchangeably with the raw
    Vision output.
    """
    if extraction is None:
        return None
    if not edits:
        return extraction

    new_steps: list[dict[str, Any]] = []
    for step in extraction.get("steps") or []:
        key = _step_key(step.get("problem_position"), step.get("step_num"))
        if key is None or key not in edits:
            new_steps.append(step)
            continue
        edited_text = (edits.get(key) or "").strip()
        if not edited_text:
            # Student cleared this step → drop from overlay.
            continue
        new_steps.append({
            **step,
            "plain_english": edited_text,
            # Clear latex: the student-typed plain-English text is the
            # new source. Vision's latex no longer matches.
            "latex": "",
        })

    new_finals: list[dict[str, Any]] = []
    for fa in extraction.get("final_answers") or []:
        key = _final_key(fa.get("problem_position"))
        if key is None or key not in edits:
            new_finals.append(fa)
            continue
        edited_text = (edits.get(key) or "").strip()
        if not edited_text:
            continue
        new_finals.append({
            **fa,
            "answer_plain": edited_text,
            "answer_latex": "",
        })

    return {
        **extraction,
        "steps": new_steps,
        "final_answers": new_finals,
    }


def validate_edits_against_extraction(
    extraction: dict[str, Any] | None,
    edits: dict[str, Any] | None,
) -> dict[str, str]:
    """Drop edit keys that don't match a real step or final-answer
    target on `extraction`. Returns a sanitized {key: text} map (text
    coerced to str, leading/trailing whitespace trimmed).

    Called from the confirm endpoint so we never persist stale or
    fabricated keys. Length and value validation (max chars, type
    checks) happen one layer up, against the request body.
    """
    if extraction is None or not edits:
        return {}

    valid_keys: set[str] = set()
    for step in extraction.get("steps") or []:
        key = _step_key(step.get("problem_position"), step.get("step_num"))
        if key is not None:
            valid_keys.add(key)
    for fa in extraction.get("final_answers") or []:
        key = _final_key(fa.get("problem_position"))
        if key is not None:
            valid_keys.add(key)

    sanitized: dict[str, str] = {}
    for key, value in edits.items():
        if key not in valid_keys:
            continue
        if not isinstance(value, str):
            continue
        sanitized[key] = value.strip()
    return sanitized
