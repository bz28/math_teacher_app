"""Probes — one module per AI feature under test.

PROBES is the registry the CLI uses to build a probe by name and to map a
changeset to the probe(s) that should run (`for-diff`).
"""

from collections.abc import Callable

from tests.harness.probe import Probe
from tests.harness.probes.generation import GenerationProbe
from tests.harness.probes.geometry import GeometryProbe

PROBES: dict[str, Callable[[int], Probe]] = {
    "geometry": lambda count: GeometryProbe(count=count),
    # `count` is per-topic here (6 curated topics), so keep it small.
    "generation": lambda count: GenerationProbe(count=count),
}
