"""AI-grading override detection + aggregation.

Pure, side-effect-free logic for the admin "AI Grading Quality" report.
Lives in a service module (not the route) so the override-detection and
direction math can be unit-tested in isolation — that's where the edge
cases hide (no-AI grade, unreadable skip, identical breakdown, a tiny
float nudge that isn't a real override).

Domain model
------------
Each graded submission carries two per-problem JSON blobs on
`SubmissionGrade`:

- `ai_breakdown` — the immutable AI snapshot: ``{"grades": [...]}`` where
  each grade has ``problem_position, score_status, percent, ...``. This is
  what the AI *originally* decided.
- `breakdown` — the teacher-editable copy, seeded from `ai_breakdown` and
  then edited in place. Each entry has ``problem_id, score_status,
  percent, ...``.

Both lists are built from the same assignment problem list **in the same
order** (see ``grading_ai._build_breakdown`` and
``teacher_assignments._normalize_breakdown`` — both preserve problem
order and emit one entry per problem). So entry *i* of `breakdown`
corresponds to grade *i* of `ai_breakdown["grades"]`. We only trust that
positional alignment when the two lists are the same length; a length
mismatch (a problem dropped at seed time, a malformed blob) makes the
submission un-alignable and we exclude it rather than mis-attribute an
override.

An **override** on a problem is either:
- a status change (``full`` ↔ ``partial`` ↔ ``zero``), or
- a percent delta beyond ``OVERRIDE_PERCENT_TOLERANCE``.

**Direction** is signed: ``final_percent - ai_percent``. A positive delta
means the teacher *raised* the score → the AI graded too harshly. Negative
means the teacher *lowered* it → the AI was too generous. Averaging the
signed delta across all compared problems gives the headline bias signal
("the AI runs ~6% too harsh").
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

# Statuses in severity order — used to render the status-change matrix
# consistently (rows = AI's call, columns = teacher's final call).
STATUSES: tuple[str, ...] = ("full", "partial", "zero")

# A percent move smaller than this isn't treated as an override. The
# teacher-facing partial-credit UI works in whole percents, so a sub-point
# difference is float noise (or a no-op re-save), not a real correction.
OVERRIDE_PERCENT_TOLERANCE = 1.0


def normalize_percent(status: Any, percent: Any) -> float | None:
    """Map a (status, percent) pair to the canonical 0–100 score.

    ``full`` pins to 100 and ``zero`` to 0 regardless of the stored
    percent (the grading pipeline forces these, but the AI snapshot can
    carry a stale/unclamped raw value, so we re-derive from status). Only
    ``partial`` reads the explicit percent, clamped to [1, 99] to match
    how the pipeline persists it. An unknown status or a non-numeric
    partial percent returns ``None`` → the problem is skipped, never
    counted as an override.
    """
    if status == "full":
        return 100.0
    if status == "zero":
        return 0.0
    if status == "partial":
        try:
            value = float(percent)
        except (TypeError, ValueError):
            return None
        return max(1.0, min(99.0, value))
    return None


@dataclass(frozen=True)
class ProblemDelta:
    """One problem's AI-vs-teacher comparison."""

    ai_status: str
    final_status: str
    ai_percent: float
    final_percent: float
    delta: float  # final - ai; + = teacher raised (AI too harsh)
    is_override: bool


def compare_grade(
    ai_breakdown: dict[str, Any] | None,
    breakdown: list[dict[str, Any]] | None,
) -> list[ProblemDelta] | None:
    """Compare a single grade's AI snapshot against the teacher's final.

    Returns one :class:`ProblemDelta` per comparable problem, or ``None``
    when the grade can't be compared at all:
    - no AI breakdown (AI never graded — e.g. unreadable skip, or a
      manual-only grade),
    - no teacher breakdown,
    - the two per-problem lists differ in length (un-alignable), or
    - neither list yields a single comparable problem.

    ``None`` means "exclude this submission from the report" — distinct
    from an empty/zero-override result, which means "compared, no change".
    """
    if not ai_breakdown or not breakdown:
        return None
    ai_grades = ai_breakdown.get("grades")
    if not isinstance(ai_grades, list) or not ai_grades:
        return None
    # Positional alignment is only sound when the lists line up 1:1.
    if len(ai_grades) != len(breakdown):
        return None

    deltas: list[ProblemDelta] = []
    for ai_g, final_g in zip(ai_grades, breakdown, strict=True):
        ai_status = ai_g.get("score_status")
        final_status = final_g.get("score_status")
        ai_pct = normalize_percent(ai_status, ai_g.get("percent"))
        final_pct = normalize_percent(final_status, final_g.get("percent"))
        # A problem with an uninterpretable status on either side can't be
        # judged — drop it rather than guess. (Skips, not exclusions: the
        # rest of the submission still counts.) A non-None percent
        # guarantees the status is one of STATUSES — narrow it for typing.
        if ai_pct is None or final_pct is None:
            continue
        assert isinstance(ai_status, str) and isinstance(final_status, str)
        delta = final_pct - ai_pct
        is_override = (ai_status != final_status) or (
            abs(delta) > OVERRIDE_PERCENT_TOLERANCE
        )
        deltas.append(
            ProblemDelta(
                ai_status=ai_status,
                final_status=final_status,
                ai_percent=ai_pct,
                final_percent=final_pct,
                delta=delta,
                is_override=is_override,
            )
        )
    return deltas or None


def summarize(deltas: Iterable[ProblemDelta]) -> dict[str, Any]:
    """Roll a flat list of problem deltas into headline metrics.

    Reused for the global summary and every group bucket (subject,
    course, day) so the math is identical everywhere.

    ``mean_delta`` is the DIRECTION signal — the average signed
    (final - ai) percent across *all* compared problems. Positive →
    AI too harsh; negative → AI too generous. ``mean_override_magnitude``
    is the average size of a change *given* the teacher intervened.
    """
    graded = 0
    overridden = 0
    raised = 0
    lowered = 0
    delta_sum = 0.0
    override_abs_sum = 0.0
    for d in deltas:
        graded += 1
        delta_sum += d.delta
        if d.is_override:
            overridden += 1
            override_abs_sum += abs(d.delta)
            if d.delta > 0:
                raised += 1
            elif d.delta < 0:
                lowered += 1

    override_rate = round(overridden / graded * 100, 1) if graded else 0.0
    mean_delta = round(delta_sum / graded, 2) if graded else 0.0
    mean_override_magnitude = (
        round(override_abs_sum / overridden, 1) if overridden else 0.0
    )

    # "balanced" is a CLAIM about calibration, and it needs evidence.
    # With no overrides at all the mean delta is trivially 0.0, and the
    # old code called that balanced — so the page announced "AI grades
    # are well-calibrated" from an empty set. Nobody having overridden
    # anything is a different statement from the AI being right, and on
    # a page whose only job is to be trustworthy the difference is the
    # whole point.
    if not overridden:
        direction = "unmeasured"
    elif mean_delta > OVERRIDE_PERCENT_TOLERANCE:
        direction = "too_harsh"
    elif mean_delta < -OVERRIDE_PERCENT_TOLERANCE:
        direction = "too_generous"
    else:
        direction = "balanced"

    return {
        "graded_problems": graded,
        "overridden_problems": overridden,
        "override_rate": override_rate,
        "mean_delta": mean_delta,
        "direction": direction,
        "mean_override_magnitude": mean_override_magnitude,
        "raised": raised,
        "lowered": lowered,
    }


def status_matrix(deltas: Iterable[ProblemDelta]) -> list[dict[str, Any]]:
    """3×3 AI-status → teacher-status transition counts.

    Always emits all nine cells (including the agreement diagonal) in a
    stable order so the UI can render a fixed heatmap/flow grid. Each cell
    carries whether it's an override (off-diagonal status change) for
    styling.
    """
    counts: dict[tuple[str, str], int] = {
        (a, b): 0 for a in STATUSES for b in STATUSES
    }
    for d in deltas:
        key = (d.ai_status, d.final_status)
        if key in counts:
            counts[key] += 1
    return [
        {
            "from": a,
            "to": b,
            "count": counts[(a, b)],
            "is_change": a != b,
        }
        for a in STATUSES
        for b in STATUSES
    ]
