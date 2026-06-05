"""Tests for the figure-rendering glue in question_bank_generation.

The helper under test (_resolve_figure) is the boundary between the
LLM's raw output and the persistence layer — it has to:
- pass valid specs through unchanged + return the rendered SVG
- return (None, None) for missing / non-dict specs (model didn't emit one)
- swallow FigureSpecError and degrade-gracefully when the spec is
  syntactically valid but semantically broken (so a bad figure
  doesn't tank the whole batch)

These cover the contract; the end-to-end "generation produces items
with figure_svg populated" path is exercised by the existing
generation integration tests once PR 2 lands and we wire a
fixture-friendly mock there.
"""

from api.core.question_bank_generation import _resolve_figure


def test_resolve_figure_passes_valid_spec_through() -> None:
    spec = {
        "type": "geometry",
        "shape": "triangle",
        "vertices": ["A", "B", "C"],
        "side_lengths": {"AB": 3.0, "BC": 4.0, "CA": 5.0},
        "right_angle_at": ["B"],
        "side_labels": {"AB": "3", "BC": "4", "CA": "5"},
    }
    out_spec, svg = _resolve_figure(spec)
    assert out_spec == spec
    assert svg is not None
    assert svg.startswith("<svg") and svg.endswith("</svg>")


def test_resolve_figure_none_when_model_emitted_nothing() -> None:
    assert _resolve_figure(None) == (None, None)


def test_resolve_figure_none_when_spec_not_a_dict() -> None:
    """The LLM occasionally returns a stringified JSON; we don't try
    to parse — we just drop. Saner than silently double-parsing."""
    assert _resolve_figure("not a dict") == (None, None)
    assert _resolve_figure([]) == (None, None)


def test_resolve_figure_swallows_renderer_errors() -> None:
    """A spec that's structurally valid (passes Pydantic) but
    semantically broken (triangle inequality) should not tank the
    job — drop the figure, keep the question. The warning is logged
    by the helper; we just verify the return contract.
    """
    bad_spec = {
        "type": "geometry",
        "shape": "triangle",
        "vertices": ["A", "B", "C"],
        "side_lengths": {"AB": 1.0, "BC": 1.0, "CA": 5.0},
    }
    out_spec, svg = _resolve_figure(bad_spec)
    assert out_spec is None
    assert svg is None


def test_resolve_figure_underdetermined_drops_gracefully() -> None:
    """Underdetermined spec — solver raises, helper swallows."""
    spec = {
        "type": "geometry",
        "shape": "triangle",
        "vertices": ["A", "B", "C"],
        "side_lengths": {"AB": 3.0},
    }
    assert _resolve_figure(spec) == (None, None)
