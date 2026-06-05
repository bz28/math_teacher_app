"""Unit tests for the LaTeX-leak detector + LatexProbe wiring."""

from __future__ import annotations

from tests.harness.latex_checks import latex_leak_check
from tests.harness.types import GeneratedItem


def test_clean_latex_passes() -> None:
    assert latex_leak_check("q", r"$\frac{a}{b}$ and $\neq$ and $\beta$").passed
    assert latex_leak_check("q", "").passed
    assert latex_leak_check("q", None).passed
    # legit newlines/tabs are NOT corruption
    assert latex_leak_check("q", "line one\n\tindented").passed


def test_corrupted_latex_fails() -> None:
    bad = latex_leak_check("q", "\x0crac{a}{b}")           # \frac -> formfeed+"rac"
    assert not bad.passed and "offset" in bad.detail
    assert not latex_leak_check("q", "\x0dightarrow").passed   # \rightarrow -> CR
    assert not latex_leak_check("q", "\x0bec{v}").passed       # \vec -> vtab
    assert not latex_leak_check("q", "\x08eta").passed         # \beta -> backspace


def test_latex_probe_checks_flag_corruption() -> None:
    from tests.harness.probes.latex import LatexProbe

    probe = LatexProbe()
    good = GeneratedItem(id="1", label="x", problem_text=r"$\frac{1}{2}$",
                         figure_svg=None, figure_spec=None, raw={"final_answer": r"$\frac{1}{2}$"})
    assert all(c.passed for c in probe.deterministic_checks(good))

    corrupt = GeneratedItem(id="2", label="y", problem_text="\x0crac{1}{2}",
                            figure_svg=None, figure_spec=None, raw={"final_answer": "ok"})
    assert any(not c.passed for c in probe.deterministic_checks(corrupt))
