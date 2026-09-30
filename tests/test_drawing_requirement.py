"""`requires_drawing(question)` — the default for a question's flag.

Leans toward flagging on purpose: drawings are recorded on every problem,
so a false positive costs a teacher click, a false negative costs a grade.
The phrasings below include every one a cold review found the first
version missing, and every trap from the prod bank that must stay off.
"""

from __future__ import annotations

import pytest

from api.core.drawing_requirement import requires_drawing
from tests.harness.probes.drawing_flag import NOT_A_DRAWING, REQUIRES_DRAWING


@pytest.mark.parametrize("question", REQUIRES_DRAWING)
def test_flags_drawing_requests(question: str) -> None:
    assert requires_drawing(question) is True


@pytest.mark.parametrize("question", NOT_A_DRAWING)
def test_does_not_flag_non_requests(question: str) -> None:
    assert requires_drawing(question) is False

def test_none_is_false() -> None:
    assert requires_drawing(None) is False
