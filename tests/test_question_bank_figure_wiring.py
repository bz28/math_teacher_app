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

from api.core.question_bank_generation import _render_step_figures, _resolve_figure
from api.core.step_decomposition import Decomposition, _cache, _cache_get, _cache_set


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


# ── _render_step_figures ────────────────────────────────────────────


def test_render_step_figures_passes_text_steps_through() -> None:
    """Steps without a figure_spec are returned unchanged."""
    steps = [
        {"title": "Setup", "description": "Identify the right triangle."},
        {"title": "Apply Pythagoras", "description": "$a^2 + b^2 = c^2$"},
    ]
    out = _render_step_figures(steps)
    assert len(out) == 2
    assert "figure_svg" not in out[0] and "figure_svg" not in out[1]
    assert out[0]["description"] == "Identify the right triangle."


def test_render_step_figures_renders_valid_spec() -> None:
    """A step with a valid figure_spec gets figure_svg populated."""
    steps = [
        {
            "title": "Draw the triangle",
            "description": "We start with a 3-4-5 right triangle.",
            "figure_spec": {
                "type": "geometry",
                "shape": "triangle",
                "vertices": ["A", "B", "C"],
                "side_lengths": {"AB": 3.0, "BC": 4.0, "CA": 5.0},
                "right_angle_at": ["B"],
            },
        },
    ]
    out = _render_step_figures(steps)
    assert out[0]["figure_svg"].startswith("<svg")
    assert out[0]["figure_spec"]["shape"] == "triangle"


def test_render_step_figures_drops_bad_spec_keeps_step() -> None:
    """A step with a triangle-inequality-violating spec keeps the
    step but loses the figure. This is the load-bearing graceful-
    degradation behavior — one bad step figure should never drop
    the whole solution.
    """
    steps = [
        {
            "title": "Broken",
            "description": "Description still valid.",
            "figure_spec": {
                "type": "geometry",
                "shape": "triangle",
                "vertices": ["A", "B", "C"],
                "side_lengths": {"AB": 1.0, "BC": 1.0, "CA": 5.0},
            },
        },
    ]
    out = _render_step_figures(steps)
    assert len(out) == 1
    assert "figure_svg" not in out[0]
    assert "figure_spec" not in out[0]
    assert out[0]["description"] == "Description still valid."


# ── Decomposition cache: figure_svg is re-rendered on read ──────────


def test_decomposition_cache_strips_figure_svg_on_set() -> None:
    """Cache must store only the canonical figure_spec, not the
    rendered SVG, so renderer-code updates take effect immediately
    instead of being shadowed by 30-minute-old cached SVGs."""
    _cache.clear()
    valid_spec = {
        "type": "geometry",
        "shape": "triangle",
        "vertices": ["A", "B", "C"],
        "side_lengths": {"AB": 3.0, "BC": 4.0, "CA": 5.0},
    }
    decomp = Decomposition(
        problem="cache-test",
        steps=[
            {
                "title": "Step 1",
                "description": "Set up the right triangle.",
                "figure_spec": valid_spec,
                "figure_svg": "<svg>STALE</svg>",  # would be cached if not stripped
            },
        ],
        final_answer="5",
        problem_type="math",
    )
    _cache_set("cache-test", decomp)
    cached_raw = _cache["cache-test"][1]
    assert "figure_svg" not in cached_raw.steps[0], (
        "cache should strip figure_svg before storage so a renderer "
        "update takes effect on next read"
    )


def test_decomposition_cache_get_re_renders_figure_svg() -> None:
    """Reading from cache produces a fresh figure_svg from the
    canonical spec, NOT a stale one that lingered from a previous
    renderer version."""
    _cache.clear()
    valid_spec = {
        "type": "geometry",
        "shape": "triangle",
        "vertices": ["A", "B", "C"],
        "side_lengths": {"AB": 3.0, "BC": 4.0, "CA": 5.0},
    }
    decomp = Decomposition(
        problem="reread-test",
        steps=[
            {
                "title": "Step 1",
                "description": "Right triangle setup.",
                "figure_spec": valid_spec,
            },
        ],
        final_answer="5",
        problem_type="math",
    )
    _cache_set("reread-test", decomp)
    fetched = _cache_get("reread-test")
    assert fetched is not None
    assert fetched.steps[0]["figure_svg"].startswith("<svg")
    assert "<polygon" in fetched.steps[0]["figure_svg"]


def test_decomposition_cache_handles_step_without_figure() -> None:
    """A step with no figure_spec stays figure-less on cache read —
    we don't invent a figure where none was requested."""
    _cache.clear()
    decomp = Decomposition(
        problem="no-figure-test",
        steps=[{"title": "Pure algebra", "description": "x = 5"}],
        final_answer="5",
        problem_type="math",
    )
    _cache_set("no-figure-test", decomp)
    fetched = _cache_get("no-figure-test")
    assert fetched is not None
    assert "figure_svg" not in fetched.steps[0]
