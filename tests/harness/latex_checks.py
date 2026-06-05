"""Detect LaTeX corruption in generated text — the $0 deterministic guard.

The classic failure (see api/core/llm_client._normalize_arrays): when Claude
returns an array field as a JSON-encoded string with single-backslash LaTeX, a
plain json.loads decodes the command's leading escape — \\frac -> formfeed+"rac",
\\rightarrow -> CR, \\vec -> vtab, \\beta -> backspace. Those control characters
are NEVER legitimate in question/solution text, so their presence is a reliable
signal that LaTeX was mangled before it ever reached the renderer.

\\n (newline) and \\t (tab) are intentionally NOT treated as corruption — they're
legitimately used in prose — so this check is high-precision (the \\f/\\v/\\b/\\r
family alone already covers \\frac, \\vec, \\beta, \\rightarrow, \\right, \\rho,
\\forall, and many more).
"""

from __future__ import annotations

import re

from tests.harness.types import CheckResult

# Strong-corruption control chars + the LaTeX family each implicates.
_CORRUPTION_RE = re.compile(r"[\f\v\b\r]")
_HINT = {
    "\f": r"\f (\frac, \forall…)",
    "\v": r"\v (\vec, \varphi…)",
    "\b": r"\b (\beta, \binom…)",
    "\r": r"\r (\rightarrow, \rho…)",
}


def latex_leak_check(label: str, text: str | None) -> CheckResult:
    """Pass unless `text` contains a strong-corruption control char (mangled
    LaTeX). Detail names the offending char + offset so failures are debuggable."""
    name = f"{label}: latex not corrupted"
    if not text:
        return CheckResult(name, True)
    m = _CORRUPTION_RE.search(text)
    if m is None:
        return CheckResult(name, True)
    hint = _HINT.get(m.group(), "control char")
    return CheckResult(name, False, f"control char {hint} at offset {m.start()} — LaTeX mangled")
