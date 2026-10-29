"""What each graph-checklist item is worth, in whole points.

A checklist's points are the graph's share of its problem. They are
stored as written (by the AI or the teacher) together with the problem's
points at that moment, and resolved every time they are read
(`fit_checklist`), so the stored copy never drifts:

- An item linked to a class rule that names points is worth the rule's
  points, live: the teacher changing the rule changes the item. A rule
  with no points leaves the item its own points; a deleted rule unlinks
  the item.
- The other items scale with the problem's points, proportionally and in
  whole points, at least 1 each. Scaling always starts from the stored
  points, so changing a problem's points back and forth never compounds
  rounding.
- The graph part stays below the problem's points: at least 1 point is
  left for the written work and the answer. Free items give way first,
  then rule items, largest first.

Pure: no database, no model.
"""

from __future__ import annotations

from dataclasses import replace
from math import floor
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from api.core.drawing_check import ChecklistItem

MAX_CHECKLIST_ITEMS = 6
MAX_CHECKLIST_ITEM_CHARS = 200


def _apportion(weights: list[int], target: int) -> list[int]:
    """`target` whole points over `weights`, proportionally (largest
    remainder, ties to the earlier item), at least 1 each."""
    if not weights:
        return []
    total = sum(weights)
    raw = [w * target / total for w in weights]
    out = [max(1, floor(r)) for r in raw]
    by_remainder = sorted(range(len(raw)), key=lambda i: (floor(raw[i]) - raw[i], i))
    k = 0
    while sum(out) < target:
        out[by_remainder[k % len(out)]] += 1
        k += 1
    # The minimum of 1 can overshoot ([1, 1, 8] over 5 floors to 1, 1, 4).
    _shrink(out, list(range(len(out))), target, 1)
    return out


def _shrink(values: list[int], order: list[int], cap: int, floor_at: int) -> None:
    """Take points off the items in `order`, largest first (ties to the
    later item), never below `floor_at`, until the sum is at most `cap`."""
    while sum(values) > cap:
        candidates = [i for i in order if values[i] > floor_at]
        if not candidates:
            return
        values[max(candidates, key=lambda i: (values[i], i))] -= 1


def fit_checklist(
    items: list[ChecklistItem],
    basis: int,
    points: int,
    rules: list[dict[str, Any]] | None = None,
) -> list[ChecklistItem]:
    """`items` as stored for a problem worth `basis` points, resolved for
    the class's current `rules` and re-sized for a problem now worth
    `points`.

    The graph part never reaches `points`. In the degenerate case of more
    items than points to give (a 3-item checklist on a 2-point problem),
    items past the budget are worth 0 rather than breaking that rule."""
    rule_points = {r["id"]: r.get("points") for r in rules or [] if r.get("id")}
    resolved: list[ChecklistItem] = []
    fixed: list[int | None] = []
    for item in items:
        rule_id = item.rule_id if item.rule_id in rule_points else None
        resolved.append(replace(item, rule_id=rule_id))
        rp = rule_points.get(rule_id) if rule_id else None
        fixed.append(rp if isinstance(rp, int) and rp > 0 else None)

    free = [i for i, f in enumerate(fixed) if f is None]
    free_points = [max(1, resolved[i].points) for i in free]
    if basis > 0 and points != basis:
        target = max(len(free), round(sum(free_points) * points / basis))
        free_points = _apportion(free_points, target)
    values = [f if f is not None else 0 for f in fixed]
    for i, p in zip(free, free_points, strict=True):
        values[i] = p

    budget = max(0, points - 1)
    rule_items = [i for i, f in enumerate(fixed) if f is not None]
    _shrink(values, free, budget, 1)
    _shrink(values, rule_items, budget, 1)
    _shrink(values, list(range(len(values))), budget, 0)
    return [replace(item, points=v) for item, v in zip(resolved, values, strict=True)]
