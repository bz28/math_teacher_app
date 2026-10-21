"""Units in a read final answer that the student's own work never shows.

The reader writes the units a question asks for into the student's
final answer even when the student wrote none (prod, Oct 2026: a page
reading "16·sin 80 = 15.76" came back as "15.76 ft"; "15.26" as
"15.26°" — at 0.95+ confidence, on clear photos, and 11 reader-prompt
variants did not stop it). A unit in the final answer that appears in
none of that problem's steps was most likely added by the reader, so
the teacher is told to check the photo. It is a pointer, not a
verdict: a student who writes the unit only on the answer line
(~1 in 7 hits in prod) is flagged too, and costs the teacher a glance.

Steps are compared by their LaTeX — the reader's prose narration
echoes the question's units ("…so the angle is 15.26 degrees") even
when the ink has none.
"""

from __future__ import annotations

import re
from typing import Any

# Canonical unit ← every spelling the reader uses for it. Single letters
# that double as variables (m, s, h, g, L) are deliberately absent: "3m"
# in an answer is as likely 3·m as three metres.
_SPELLINGS: dict[str, tuple[str, ...]] = {
    "ft": ("ft", "feet", "foot"),
    "in": ("in", "inch", "inches"),
    "yd": ("yd", "yard", "yards"),
    "mi": ("mi", "mile", "miles"),
    "cm": ("cm", "centimeter", "centimeters", "centimetre", "centimetres"),
    "mm": ("mm", "millimeter", "millimeters"),
    "km": ("km", "kilometer", "kilometers"),
    "meters": ("meter", "meters", "metre", "metres"),
    "rad": ("rad", "rads", "radian", "radians"),
    "°": ("deg", "degree", "degrees"),
    "sec": ("sec", "secs", "second", "seconds"),
    "min": ("min", "mins", "minute", "minutes"),
    "hr": ("hr", "hrs", "hour", "hours"),
    "mph": ("mph",),
    "rpm": ("rpm",),
    "rev": ("rev", "revs", "revolution", "revolutions"),
    "lb": ("lb", "lbs", "pound", "pounds"),
    "kg": ("kg", "kilogram", "kilograms"),
    "gal": ("gal", "gallon", "gallons"),
    "units": ("unit", "units"),
}
_CANONICAL = {spelling: unit for unit, spellings in _SPELLINGS.items() for spelling in spellings}

_DEGREE = re.compile(r"\^\s*\{?\s*\\circ\s*\}?|°|\\degree")
# A unit follows a number: "15.76 ft", "3\,cm", "48\pi \text{ rad/min}",
# "12 feet per minute". Words inside \text{} count only in that position —
# "\text{min}(a, b)" or "\text{the point lies in quadrant II}" are prose.
_AFTER_NUMBER = re.compile(
    r"(?:\d|\\pi|\})\s*(?:\\[,;:! ]|~)?\s*"
    r"(?:\\(?:text|mathrm|textrm)\s*\{(?P<run>[^{}]*)\}|(?P<bare>[A-Za-z][A-Za-z /]*))",
)
_WORD = re.compile(r"[A-Za-z]+")
# Words that can sit between a number and its unit ("12 square feet",
# "3 feet per minute") without ending it.
_JOINERS = {"per", "square", "sq", "cubic", "cu"}


def units_in(text: str, *, in_prose: bool = False) -> set[str]:
    """Canonical units written in a LaTeX or plain-text snippet.

    By default a unit followed by ordinary words is read as a sentence
    ("2 in quadrant II") and ignored — right for an answer, where a false
    unit raises a false flag. `in_prose=True` keeps it ("15.76 feet up
    the wall") — right for the work, where a missed unit does.
    """
    found: set[str] = set()
    if _DEGREE.search(text):
        found.add("°")
    for m in _AFTER_NUMBER.finditer(text):
        run: set[str] = set()
        for word in _WORD.findall(m["run"] if m["run"] is not None else m["bare"]):
            unit = _CANONICAL.get(word.lower())
            if unit:
                run.add(unit)
            elif word.lower() not in _JOINERS:
                # Words after the number that aren't units: a sentence
                # ("2 in quadrant II"), not a measurement.
                if not in_prose:
                    run = set()
                break
        found |= run
    return found


def _work_text(step: dict[str, Any]) -> str:
    # LaTeX is the transcription of the ink; prose stands in only when a
    # step has no LaTeX at all (the student wrote words, not math).
    return (step.get("latex") or "").strip() or (step.get("plain_english") or "").strip()


def units_not_in_work(final_answer: str, steps: list[dict[str, Any]]) -> list[str]:
    """Units in `final_answer` that none of `steps` contains, in a stable
    order. Empty when the problem has no steps — with no work to compare
    against there is nothing to say."""
    if not steps:
        return []
    in_work: set[str] = set()
    for step in steps:
        in_work |= units_in(_work_text(step), in_prose=True)
    return sorted(units_in(final_answer) - in_work)
