"""Probes — one module per AI feature under test.

PROBES is the registry the CLI uses to build a probe by name and to map a
changeset to the probe(s) that should run (`for-diff`).
"""

from collections.abc import Callable

from tests.harness.probe import Probe
from tests.harness.probes.generation import GenerationProbe
from tests.harness.probes.geometry import GeometryProbe
from tests.harness.probes.grading import GradingProbe
from tests.harness.probes.latex import LatexProbe

PROBES: dict[str, Callable[[int], Probe]] = {
    "geometry": lambda count: GeometryProbe(count=count),
    # Curated probe: the per-topic count is a fixed property of the suite, not
    # the CLI --count, so a default `--probe generation` run is predictable.
    "generation": lambda count: GenerationProbe(),
    # LaTeX-integrity guard — real generation over LaTeX-heavy topics, fails on
    # the control-char corruption signature.
    "latex": lambda count: LatexProbe(count=count),
    # Grading-quality golden set: a fixed 12-case labeled suite, so (like
    # generation) the per-case count is a property of the suite, not --count.
    "grading": lambda count: GradingProbe(),
}
