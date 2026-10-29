// Homework points on the teacher side. Grades stay a percent per
// problem; these helpers turn them into the points a teacher reads.
// Mirrors api/core/homework_points.py.

export const MAX_TOTAL_POINTS = 1000;

/** `total` in whole points over `count` problems, remainder to the
 *  first ones (100 over 7 → 15, 15, 14, 14, 14, 14, 14). Every problem is
 *  worth at least 1. */
export function evenSplit(total: number, count: number): number[] {
  if (count <= 0) return [];
  const t = Math.max(total, count);
  const base = Math.floor(t / count);
  const extra = t % count;
  return Array.from({ length: count }, (_, i) => (i < extra ? base + 1 : base));
}

/** A points figure as a teacher writes it: whole numbers bare, halves
 *  and tenths with one decimal ("14", "11.5"). */
export function formatPoints(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Points earned on something worth `worth` at `percent`, to a tenth. */
export function earnedPoints(percent: number, worth: number): number {
  return Math.round((percent * worth) / 10 + 1e-9) / 10;
}

/** Each deduction (a percent of the problem) in points, to a tenth, so
 *  the lines add up exactly to `lost`, the points the receipt says the
 *  problem lost. Rounding each line on its own can leave the receipt a
 *  point off its own total; the tenths go to the lines that were rounded
 *  down the most instead. */
export function deductionPoints(percentsOff: number[], worth: number, lost: number): number[] {
  const exact = percentsOff.map((p) => (p * worth) / 100);
  const tenths = exact.map((e) => Math.floor(e * 10 + 1e-9));
  const target = Math.round(lost * 10);
  let left = target - tenths.reduce((s, t) => s + t, 0);
  const order = exact
    .map((e, i) => ({ i, rem: e * 10 - tenths[i] }))
    .sort((a, b) => b.rem - a.rem);
  for (const { i } of order) {
    if (left <= 0) break;
    tenths[i] += 1;
    left -= 1;
  }
  return tenths.map((t) => t / 10);
}

/** "14–15 each" / "10 each" / "1–20" for a publish summary line. */
export function pointsRange(values: number[]): string {
  if (values.length === 0) return "";
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? `${lo} each` : `${lo}–${hi} each`;
}
