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

import inspect

import pytest

from api.core import assignment_generation
from api.core.question_bank_generation import _empty_result_message


def test_message_names_skipped_files_as_the_likely_cause() -> None:
    msg = _empty_result_message(docs_selected=8, docs_used=5)
    assert "3 of your 8 source files weren't sent" in msg
    # It must point at the selection, not at her wording.
    assert "adjusting your instructions" not in msg
    assert "fewer or smaller files" in msg


def test_message_falls_back_when_every_file_was_sent() -> None:
    """Nothing was dropped, so the instructions really are the best lead."""
    msg = _empty_result_message(docs_selected=3, docs_used=3)
    assert "adjusting your instructions" in msg
    assert "weren't sent" not in msg


def test_message_is_generic_when_no_documents_were_attached() -> None:
    msg = _empty_result_message(docs_selected=0, docs_used=0)
    assert "adjusting your instructions" in msg


def test_generate_questions_no_longer_swallows_api_errors() -> None:
    """A raised API error must reach the caller, not become [].

    Masking it made an oversized request, a page-count rejection and a
    timeout all arrive as "the AI didn't return any questions".
    """
    source = inspect.getsource(assignment_generation.generate_questions)
    tail = source[source.rindex("except Exception:"):]
    assert "raise" in tail, "generate_questions must re-raise"
    assert "return []" not in tail, "generate_questions must not mask the error"


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
