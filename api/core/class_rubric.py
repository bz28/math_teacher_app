"""A class's grading rubric: the teacher's standing rules for every homework.

A teacher's grading standards — "final answers need units", "write the
axis as y = 1", "label every key point" — hold across a whole class, not
one homework. They live on `Course.rubric` as a list of rules, and every
homework in the course inherits them. A homework's own rubric
(`Assignment.rubric`) adds to them: extra rules (`notes`), common
mistakes, and `skipped_rule_ids` to opt out of a class rule. Where the two
disagree, the homework wins — the grading prompt says so.

`effective_rubric` merges the two into the one dict the grader reads and
`SubmissionGrade.rubric_snapshot` freezes, so a grade always records
exactly which rules it was graded under.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_CLASS_RULES = 30
MAX_RULE_CHARS = 300
RULE_SOURCES = ("settings", "suggestion")


def new_rule_id() -> str:
    """Short, stable id the grader cites back on a deduction. Opaque on
    purpose: a rule's text can be edited without breaking the grades that
    already cite it."""
    return f"r{uuid.uuid4().hex[:8]}"


class ClassRubricRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Omitted on a new rule — the server assigns one.
    id: str | None = Field(default=None, max_length=40)
    text: str = Field(min_length=1, max_length=MAX_RULE_CHARS)
    # Points off a problem (0-100 scale) when the rule is broken. None =
    # the teacher didn't say; the grader sizes it like a small slip.
    points: int | None = Field(default=None, ge=0, le=100)
    source: Literal["settings", "suggestion"] = "settings"
    # Where a suggested rule came from ("HW 5"), for the settings list.
    source_label: str | None = Field(default=None, max_length=300)
    added_at: str | None = None

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("A rule needs some text")
        return v


class ClassRubric(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rules: list[ClassRubricRule] = Field(default_factory=list, max_length=MAX_CLASS_RULES)

    def to_stored(self, previous: dict[str, Any] | None) -> dict[str, Any] | None:
        """The value written to `Course.rubric`. Keeps each existing
        rule's id and `added_at`, stamps new ones, and returns None when
        no rules are left — an empty rubric and no rubric mean the same
        thing to every reader."""
        known = {
            r.get("id"): r for r in (previous or {}).get("rules", [])
            if isinstance(r, dict)
        }
        now = datetime.now(UTC).isoformat()
        rules: list[dict[str, Any]] = []
        seen: set[str] = set()
        for rule in self.rules:
            # A repeated id (a hand-built request) gets a fresh one, so a
            # cited or skipped id always means exactly one rule.
            prior = known.get(rule.id) if rule.id and rule.id not in seen else None
            if prior and rule.id:
                seen.add(rule.id)
            rules.append({
                "id": rule.id if prior else new_rule_id(),
                "text": rule.text,
                "points": rule.points,
                "source": prior.get("source", rule.source) if prior else rule.source,
                "source_label": (
                    prior.get("source_label") if prior else rule.source_label
                ),
                "added_at": prior.get("added_at") if prior else now,
            })
        return {"rules": rules} if rules else None


def class_rules(course_rubric: dict[str, Any] | None) -> list[dict[str, Any]]:
    """The stored rules, tolerating a null rubric."""
    return [
        r for r in (course_rubric or {}).get("rules", [])
        if isinstance(r, dict) and r.get("id") and r.get("text")
    ]


def effective_rubric(
    course_rubric: dict[str, Any] | None,
    assignment_rubric: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """What the grader applies to one homework: the homework's own fields
    plus the class rules it hasn't skipped.

    `rules` carries only what the grader and the drift check need (id,
    text, points). Returns None when there is nothing at all, matching the
    "no rubric" meaning of None everywhere else.
    """
    hw = dict(assignment_rubric or {})
    skipped = set(hw.pop("skipped_rule_ids", None) or [])
    rules = [
        {"id": r["id"], "text": r["text"], "points": r.get("points")}
        for r in class_rules(course_rubric)
        if r["id"] not in skipped
    ]
    if rules:
        hw["rules"] = rules
    return hw or None
