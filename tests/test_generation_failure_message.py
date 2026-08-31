"""The generation failure message must not blame the teacher's prompt.

When a generation came back with nothing, the teacher was always told to
"try adjusting your instructions" — even when the real cause was that
her source files never got sent, because the selection exceeded the
per-call file count or the request size budget. That sends her to
rewrite a prompt that was fine and never mentions the thing she could
actually fix.

Two changes are pinned here:
- an API failure now propagates its own cause instead of being masked as
  an empty result (`generate_questions` used to `return []` on any
  exception), and
- when documents were left behind, the message says so.
"""

import pytest

from api.core import assignment_generation
from api.core.document_vision import MAX_TOTAL_SOURCE_B64_BYTES, MAX_VISION_IMAGES
from api.core.question_bank_generation import (
    TeacherFacingGenerationError,
    _empty_result_message,
)


def test_message_names_skipped_files_as_a_likely_cause() -> None:
    msg = _empty_result_message(docs_selected=8, docs_used=5)
    assert "3 of your 8 source files weren't sent" in msg
    assert "fewer or smaller files" in msg
    # Offered as *a* cause, not *the* cause: the model can also return
    # nothing on a selection that fit fine, so keep the other lead.
    assert "may be why" in msg
    assert "adjust your instructions" in msg


def test_message_falls_back_when_every_file_was_sent() -> None:
    """Nothing was dropped, so the instructions really are the best lead."""
    msg = _empty_result_message(docs_selected=3, docs_used=3)
    assert "adjusting your instructions" in msg
    assert "weren't sent" not in msg


def test_message_is_generic_when_no_documents_were_attached() -> None:
    msg = _empty_result_message(docs_selected=0, docs_used=0)
    assert "adjusting your instructions" in msg


@pytest.mark.asyncio
async def test_generate_questions_propagates_the_underlying_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """End-to-end on the swallow: a failing LLM call surfaces its cause."""
    async def boom(*_a: object, **_k: object) -> dict[str, object]:
        raise RuntimeError("Error code: 400 - request too large")

    monkeypatch.setattr(assignment_generation, "call_claude_json", boom)
    with pytest.raises(RuntimeError, match="request too large"):
        await assignment_generation.generate_questions("Trig/Precalculus", 3)


def test_message_size_is_derived_from_the_real_budget() -> None:
    """The MB figure must track the constant, not a hand-typed number —
    changing the budget shouldn't silently make the message lie."""
    msg = _empty_result_message(docs_selected=8, docs_used=5)
    expected_mb = round(MAX_TOTAL_SOURCE_B64_BYTES * 3 / 4 / 1024 / 1024)
    assert f"about {expected_mb}MB" in msg
    assert f"carries {MAX_VISION_IMAGES} files" in msg


def test_provider_errors_are_not_shown_to_the_teacher() -> None:
    """job.error_message renders verbatim in the UI.

    Letting the real exception through is right for OUR copy and wrong
    for a provider's: "Claude Vision API error: Error code: 400 -
    {'type': 'error', ...}" tells a teacher nothing and puts our
    internals in a red banner.
    """
    provider = RuntimeError(
        "Claude Vision API error: Error code: 400 - {'type': 'error'}"
    )
    assert not isinstance(provider, TeacherFacingGenerationError)

    ours = TeacherFacingGenerationError(_empty_result_message(8, 5))
    assert isinstance(ours, TeacherFacingGenerationError)
    # ...and still a RuntimeError, so _run_job's handler still catches it.
    assert isinstance(ours, RuntimeError)


def test_every_teacher_worded_raise_is_marked_teacher_facing() -> None:
    """Copy written for the teacher must carry the type that shows it.

    The type gates whether `job.error_message` reaches her or gets
    swapped for generic text. A message written in her language but
    raised as a plain RuntimeError is silently downgraded — which is
    exactly what happened to the parent-deleted message when the type
    was introduced. Anything phrased for her belongs on the left.
    """
    import re
    from pathlib import Path

    source = Path("api/core/question_bank_generation.py").read_text()
    # Only inspect the async worker path, whose raises land in
    # error_message via _run_job.
    worker = source[source.index("async def _run_generation("):source.index("async def _revise")] \
        if "async def _revise" in source else source[source.index("async def _run_generation("):]

    plain = re.findall(r'raise RuntimeError\(\s*\n?\s*"([^"]{20,})"', worker)
    # Phrases that address the teacher rather than describe our internals.
    teacher_words = ("your", "Try ", "Make sure", "could be generated")
    leaked = [m for m in plain if any(w in m for w in teacher_words)]
    assert not leaked, (
        "these read as teacher-facing but are raised as plain RuntimeError, "
        f"so she'd see generic copy instead: {leaked}"
    )
