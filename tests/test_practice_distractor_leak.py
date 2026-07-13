"""Unit tests for the distractor answer-leak stripper.

`generate_distractors` asks the model to return the BARE wrong value for each
MCQ option, but the model occasionally appends a give-away tell like
"(sign error)" or ", off by one". `_strip_distractor_leak` is the defense in
depth that removes such a trailing tell before it reaches a graded MCQ — while
never touching legitimate math (ordered pairs, intervals, sin(theta), matrices)
that merely happens to end in a bracket or contain a comma.

These are pure-function tests: no DB, no network, no Claude call.
"""
from __future__ import annotations

import pytest

from api.core.practice import _strip_distractor_leak

# (input, expected) — a leaked tell that MUST be stripped, in every delimiter
# shape the model has been observed to use.
STRIP_CASES = [
    # Parenthetical (the original, pre-existing case).
    ("x = 5 (sign error)", "x = 5"),
    ("$12$ (forgot to subtract)", "$12$"),
    ("7 (off by one)", "7"),
    ("$-\\frac{1}{2}$ (missed a step)", "$-\\frac{1}{2}$"),
    # Comma-introduced tell.
    ("x = 5, sign error", "x = 5"),
    ("$3x$, forgot to distribute", "$3x$"),
    # Em-dash / en-dash introduced tell.
    ("x = 5 — off by one", "x = 5"),
    ("y = -3 – dropped a term", "y = -3"),
    # Bracketed tell.
    ("x = 5 [forgot to subtract]", "x = 5"),
    ("42 [reversed the inequality]", "42"),
]

# Inputs that must survive UNCHANGED — the keyword anchor is what keeps these
# safe. None of them contain a leak keyword, so nothing is stripped even though
# they end in a bracket/paren or contain a comma.
MUST_KEEP = [
    r"$\sin(\theta)$",
    "(0, 1)",          # ordered pair
    "[0, 1]",          # interval
    "[0, 10]",         # interval that used to trip the naive "[" check
    "(x+1)",
    "5",
    "x = -5",          # trailing dash is a minus sign, not a delimiter
    "1, 2, 3",         # list answer, no tell
    r"$\begin{pmatrix}1&2\\3&4\end{pmatrix}$",  # matrix literal
    "$(a, b)$",
]


@pytest.mark.parametrize("raw,expected", STRIP_CASES)
def test_strips_leaked_tell(raw: str, expected: str) -> None:
    assert _strip_distractor_leak(raw) == expected


@pytest.mark.parametrize("raw", MUST_KEEP)
def test_preserves_legitimate_math(raw: str) -> None:
    assert _strip_distractor_leak(raw) == raw


def test_bare_commentary_falls_back_to_trimmed_original() -> None:
    # A distractor that is ONLY a tell would strip to empty; the fallback keeps
    # the trimmed original rather than emitting an empty MC option.
    assert _strip_distractor_leak("(missing)") == "(missing)"
    assert _strip_distractor_leak("  x = 5  ") == "x = 5"
