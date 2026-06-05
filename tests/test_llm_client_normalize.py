"""Unit tests for `_normalize_arrays` — LaTeX survives the stringified-array path.

Regression for the control-char corruption: when Claude returns an array field
as a JSON-encoded string with single-backslash LaTeX, a plain `json.loads`
decodes `\f`/`\r`/`\b`/`\v` into control characters (`\frac` -> formfeed+"rac",
`\neq` -> newline+"eq"). These assert the math survives, while properly-escaped
content + legitimate newlines stay untouched.
"""

from __future__ import annotations

from typing import Any

from api.core.llm_client import _normalize_arrays

_STEPS_SCHEMA = {"input_schema": {"properties": {"steps": {"type": "array"}}}}


def _norm(value: Any) -> Any:
    return _normalize_arrays({"steps": value}, _STEPS_SCHEMA)["steps"]


def _no_control_chars(s: str) -> bool:
    return not any(c in s for c in "\f\v\b\r")


def test_single_escaped_latex_survives() -> None:
    # The bug: array stringified with single-backslash LaTeX. \frac \neq \nabla
    # \times \beta all start with valid JSON-escape letters (\f \n \b \t).
    value = r'[{"description":"$\frac{a}{b}$, $x \neq y$, $\nabla f$, $2 \times 3$, $\beta$"}]'
    desc = _norm(value)[0]["description"]
    assert _no_control_chars(desc)
    for cmd in (r"\frac", r"\neq", r"\nabla", r"\times", r"\beta"):
        assert cmd in desc, f"{cmd} lost"


def test_properly_escaped_with_real_newline_preserved() -> None:
    # Valid JSON: \\frac is an escaped backslash (LaTeX), \n is a real newline.
    value = '[{"description": "step one.\\n\\nThen $\\\\frac{1}{2}$"}]'
    desc = _norm(value)[0]["description"]
    assert "\n\n" in desc          # legitimate paragraph break kept
    assert r"\frac" in desc        # latex kept
    assert _no_control_chars(desc)


def test_embedded_quotes_preserved() -> None:
    value = r'[{"description":"the so-called \"identity\" $\frac{1}{2}$"}]'
    desc = _norm(value)[0]["description"]
    assert '"identity"' in desc
    assert r"\frac" in desc


def test_matrix_line_break_survives() -> None:
    # \begin/\end + a `\\` line break (two literal backslashes).
    value = r'[{"description":"$\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}$"}]'
    desc = _norm(value)[0]["description"]
    assert r"\begin{pmatrix}" in desc and r"\end{pmatrix}" in desc
    assert r"\\" in desc           # the line break stays two backslashes
    assert _no_control_chars(desc)


def test_plain_text_array_unaffected() -> None:
    assert _norm('["just text", "no latex"]') == ["just text", "no latex"]


def test_real_array_left_alone() -> None:
    steps = [{"description": r"$\frac{a}{b}$"}]
    assert _normalize_arrays({"steps": steps}, _STEPS_SCHEMA)["steps"] == steps


def test_non_array_schema_field_ignored() -> None:
    schema = {"input_schema": {"properties": {"answer": {"type": "string"}}}}
    out = _normalize_arrays({"answer": r'["$\frac{1}{2}$"]'}, schema)
    assert out["answer"] == r'["$\frac{1}{2}$"]'  # string field, not coerced
