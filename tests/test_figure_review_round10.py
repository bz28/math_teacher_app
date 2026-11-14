"""Review round 10 (the confirm round at 6e51bca5) of PR #989: derived facts come from the text.

The reviewer's script: "In △ABC and △CBE, altitude CD of △CBE is drawn."
Reading a put CD ⊥ AB (the wrong side); reading b left △CBE out of its
triangle list, so for b "altitude CD" fitted the one triangle it had, ABC,
and code derived CD ⊥ AB from b too: the readings "agreed" and a wrong
figure passed. With b = a, the perpendicular fact's word "altitude" and
the listed △CBE accounted for "altitude CD of △CBE" without anything
checking which triangle the altitude is of.

The rule now (coverage.py `_text_triangles`, construction_figures.py
`trusted_reading`):
1. a derived fact uses the parts the TEXT names ("altitude CD of △CBE": the
   side of △CBE opposite C), never a reading's own lists; when the text
   names two triangles that could hold the altitude and doesn't say which,
   the phrase is a gap; "altitude" is accounted for only by this rule;
2. coverage runs on both readings, and a gap in either refuses;
3. the derived facts are worked out once (both readings must derive the
   same ones) and added to both readings and to the checked facts.
The base-angle and exterior-angle rules take their triangles from the text
the same way; the scripts below are the reviewer's suspicion, refuted.
"""

from __future__ import annotations

from typing import Any

import pytest

from api.core.construction_figures import trusted_reading
from api.core.geometry import coverage as cv
from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.facts import Fact, FigureFacts, Target, standard_reading
from api.core.geometry.figure_check import check_construction


def fig(**kw: Any) -> ConstructionFigure:
    return ConstructionFigure.model_validate({"type": "geometry", "shape": "construction", **kw})


def F(kind: str, items: tuple[str, ...] | list[str] = (), **kw: Any) -> Fact:  # noqa: N802
    return Fact(kind=kind, items=list(items), **kw)  # type: ignore[arg-type]


def passes(text: str, a: FigureFacts, figure: ConstructionFigure, b: FigureFacts | None = None) -> bool:
    t = trusted_reading(text, a, b or a)[0]
    return t is not None and not check_construction(figure, text, facts=t)


def derived(text: str, facts: FigureFacts) -> list[tuple[Any, ...]]:
    return [(d.kind, tuple(d.items), d.point) for d in cv.coverage(text, standard_reading(facts))[1]]


ALT = r"In $\triangle ABC$ and $\triangle CBE$, altitude $\overline{CD}$ of $\triangle CBE$ is drawn. Find $CD$."
ALT_Q = "altitude CD of △CBE is drawn"


def _alt(tris: list[str], *givens: Fact) -> FigureFacts:
    return FigureFacts(points=list("ABCDE"), find=[Target(kind="segment", item="CD")], segments=["CD"],
                       triangles=tris, givens=list(givens))


# CD ⊥ AB at D = (2, 0), not ⊥ BE.
ON_AB = fig(points={"A": (0, 0), "B": (6, 0), "C": (2, 4), "E": (8, 5), "D": (2, 0)},
            segments=["AB", "BC", "CA", "BE", "EC", "CD"], right_angles=["CDB"])


def test_the_reviewers_altitude_of_the_other_triangle() -> None:
    a = _alt(["ABC", "CBE"], F("perpendicular", ["CD", "AB"], point="D", quote=ALT_Q))
    b = _alt(["ABC"])
    assert not passes(ALT, a, ON_AB, b)  # b omits △CBE: a gap in b
    assert not passes(ALT, a, ON_AB)  # b = a: the derived CD ⊥ BE is checked
    assert derived(ALT, b) == [("perpendicular", ("CD", "BE"), "D")]  # from the text, not b's list
    # The figure the words describe: D the foot on BE (line), CD ⊥ BE.
    right = fig(points={"A": (0, 0), "B": (6, 0), "C": (2, 4), "E": (8, 5), "D": (6.828, 2.069)},
                segments=["AB", "BC", "CA", "BE", "EC", "CD"], right_angles=["CDB"])
    good = _alt(["ABC", "CBE"], F("perpendicular", ["CD", "BE"], point="D", quote=ALT_Q))
    assert passes(ALT, good, right)


def test_an_altitude_with_two_candidate_triangles_and_none_named_is_a_gap() -> None:
    text = r"In $\triangle ABC$ and $\triangle CBE$, altitude $\overline{CD}$ is drawn. Find $CD$."
    facts = _alt(["ABC", "CBE"], F("perpendicular", ["CD", "AB"], point="D", quote="altitude CD is drawn"))
    assert any("altitude" in g for g in cv.coverage(text, standard_reading(facts))[0])


def test_altitude_is_not_a_perpendicular_facts_word() -> None:
    assert "altitude" not in cv.VOCAB["perpendicular"]


def test_coverage_runs_on_both_readings() -> None:
    text = r"In $\triangle ABC$, $AB = 5$ and $AC = 6$."
    a = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
        F("equal_length", ["AB"], value=5, quote="AB = 5"), F("equal_length", ["AC"], value=6, quote="AC = 6")])
    b = a.model_copy(update={"triangles": []})  # leaves △ABC unread: a gap in b only
    assert trusted_reading(text, a, a)[0] is not None
    assert trusted_reading(text, a, b)[0] is None


def test_the_readings_must_derive_the_same_facts(monkeypatch: pytest.MonkeyPatch) -> None:
    text = r"In $\triangle ABC$, $AB = 5$."
    a = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[F("equal_length", ["AB"], value=5, quote="AB = 5")])
    b = a.model_copy(update={"segments": ["AB"]})  # a different object, the same facts
    real = cv.coverage

    def coverage(t: str, facts: FigureFacts, context: str = "") -> tuple[list[str], list[Fact]]:
        gaps, ds = real(t, facts, context)
        return gaps, [*ds, F("on_segment", ["AB"], point="C")] if facts.segments else ds

    monkeypatch.setattr(cv, "coverage", coverage)
    assert trusted_reading(text, a, b)[0] is None
    assert trusted_reading(text, a, a)[0] is not None


# ── The same hole in the base-angle and exterior-angle rules: refuted ─

BASE = (r"In $\triangle ABC$ and $\triangle DEF$, $AB = AC$ and $DE = DF$. Each base angle of $\triangle DEF$ "
        r"measures $50^\circ$. Find $m\angle D$.")
BASE_Q = "Each base angle of △DEF measures 50°"


def _base(tris: list[str], *vs: str) -> FigureFacts:
    return FigureFacts(points=list("ABCDEF"), triangles=tris, find=[Target(kind="angle", item="D")], givens=[
        F("congruent_segments", ["AB", "AC"], quote="AB = AC"), F("congruent_segments", ["DE", "DF"], quote="DE = DF"),
        *[F("angle_measure", [v], value=50, quote=BASE_Q) for v in vs]])


def test_base_angles_of_a_named_triangle_come_from_the_text() -> None:
    assert derived(BASE, _base(["ABC"], "B", "C")) == [("angle_measure", ("DEF",), None),
                                                       ("angle_measure", ("DFE",), None)]
    assert cv.coverage(BASE, standard_reading(_base(["ABC"], "B", "C")))[0] != []  # △DEF unread: a gap
    assert trusted_reading(BASE, _base(["ABC", "DEF"], "B", "C"), _base(["ABC"], "B", "C"))[0] is None


EXT = (r"In $\triangle PQR$ and $\triangle PST$, an exterior angle is formed at vertex $P$ by extending side "
       r"$\overline{RP}$ beyond $P$ to point $T$. Find $m\angle QPT$.")


def test_an_exterior_angle_uses_the_texts_triangles() -> None:
    facts = FigureFacts(points=list("PQRST"), triangles=["PQR", "PST"], find=[Target(kind="angle", item="QPT")],
                        givens=[F("extension", ["RP"], point="T", quote="extending side RP beyond P to point T")])
    want = [("extension", ("RP",), "T")]
    assert derived(EXT, facts) == want
    fewer = facts.model_copy(update={"triangles": ["PST"]})  # a reading that left out △PQR
    assert derived(EXT, fewer) == want and cv.coverage(EXT, standard_reading(fewer))[0] != []


def test_an_altitude_of_something_else_is_a_gap() -> None:
    """"altitude CD of quadrilateral ABCE": not of a triangle; the one
    triangle the text names is not what the words say."""
    text = r"In $\triangle ABC$, altitude $\overline{CD}$ of quadrilateral $ABCE$ is drawn. Find $CD$."
    facts = FigureFacts(points=list("ABCDE"), triangles=["ABC"], polygons=["ABCE"], segments=["CD"],
                        find=[Target(kind="segment", item="CD")])
    assert any("altitude" in g for g in cv.coverage(text, standard_reading(facts))[0])
