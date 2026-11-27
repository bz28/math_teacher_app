/** Labels and units shared by the Grading tab and its drill-in. */

export const STATUS_LABEL: Record<string, string> = {
  full: "Full",
  partial: "Partial",
  zero: "Zero",
};

// Delta unit is percentage-POINTS on the 0–100 per-problem score — the
// SAME scale everywhere (hero, tiles, rows, drill). Never rendered as a
// bare "%", which reads as a relative change.
export function fmtPts(v: number, signed = false): string {
  const sign = signed && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)} pts`;
}
