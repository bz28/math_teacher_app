"""Table-driven cases for the don't-know matcher.

The SAME table lives in web/src/components/school/student/
integrity-message-rules.test.ts and mobile/src/utils/integrityMinimum.test.ts
— change all three together.
"""

from __future__ import annotations

import pytest

from api.core.integrity_non_answer import is_non_answer, normalize_reply

NON_ANSWERS = [
    "I don't know",
    "I don’t know",
    "i dont know",
    "I do not know.",
    "IDK!!",
    "idk idk idk",
    "dunno",
    "I dunno lol",
    "no idea",
    "I have no idea",
    "honestly I have no idea",
    "not sure lol",
    "not really sure",
    "I'm not sure",
    "Im not sure",
    "no clue",
    "I'm stuck",
    "i forgot",
    "I give up",
    "skip",
    "?",
    "???",
    "nothing",
    "um idk 🤷",
    "I don't know how to explain this",
    "I’m not sure — idk",
]

ANSWERS = [
    "y=2x+3",
    "x=-3/2",
    "(3, 4)",
    "x=2, y=3",
    "12.5 cm",
    "x = 4",
    "factorization",
    "I subtracted 3",
    "I divided both sides by two",
    "I don't know if this is right but x = 4",
    "I'm not sure but I think I factored it",
    "I forgot to carry the 2",
    "nope",
    "I did",
    "that's it",
    "slope intercept form",
]


@pytest.mark.parametrize("text", NON_ANSWERS)
def test_non_answers_are_caught(text: str) -> None:
    assert is_non_answer(text)


@pytest.mark.parametrize("text", ANSWERS)
def test_answers_pass(text: str) -> None:
    assert not is_non_answer(text)


def test_normalize_matches_smart_punctuation_and_case() -> None:
    assert normalize_reply("I’M STUCK – I’m not sure how to explain this") == (
        normalize_reply("I'm stuck — I'm not sure how to explain this.")
    )
