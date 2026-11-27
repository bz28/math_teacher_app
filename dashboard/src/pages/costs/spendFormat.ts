/**
 * The Spend tab's pure pieces — number formats, bucket labels, where a
 * breakdown row drills, when the concentration note shows — kept apart
 * from the component so `npm test` can pin them.
 */

import type { SpendBucket, SpendData, SpendGroup, SpendRow } from "../../lib/costsApi.ts";

export const BREAKDOWN_HOURS = 720;

// The school key /admin/spend gives calls stamped with no school.
const INTERNAL = "internal";

export function usd(n: number, digits = 2): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function perCall(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1) return usd(n);
  // Haiku calls cost fractions of a cent: keep two significant figures.
  return n > 0 && n < 0.001 ? `$${n.toPrecision(2)}` : `$${n.toFixed(3)}`;
}

/** A bar's label: blank for nothing, never "0.00" over a real bar. */
export function barValue(n: number): string {
  if (!n) return "";
  return n < 0.01 ? "<0.01" : n.toFixed(2);
}

export function monthName(iso: string, style: "long" | "short" = "short"): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: style, timeZone: "UTC" });
}

/** The headline's month names and the day "this month" runs through —
 * read off the response's month start and window end, in UTC. */
export function monthLabels(monthStart: string, windowEnd: string) {
  const start = new Date(`${monthStart}T00:00:00Z`);
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  return {
    thisMonth: monthName(monthStart),
    lastMonth: monthName(last.toISOString().slice(0, 10)),
    throughDay: new Date(windowEnd).getUTCDate(),
  };
}

export function bucketLabel(iso: string, bucket: SpendBucket): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (bucket === "month") return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Where a row drills to: the debug level it names. */
export function drillTo(row: SpendRow, group: SpendGroup): string | null {
  // The remainder row, and Internal (calls with no school), have no page.
  if (row.key === null || (group === "school" && row.key === INTERNAL)) return null;
  const key = encodeURIComponent(row.key);
  switch (group) {
    case "school": return `/schools/${key}`;
    case "teacher": return `/teachers/${key}`;
    case "student": return `/students/${key}`;
    case "function": return `/llm-calls?function=${key}&hours=${BREAKDOWN_HOURS}`;
    case "model": return `/llm-calls?model=${key}&hours=${BREAKDOWN_HOURS}`;
  }
}

/** Whether to warn that one school carries the spend. Scoped to a single
 * school, "one school drives 100%" says nothing, so never then. */
export function isConcentrated(c: SpendData["concentration"], scoped: boolean): boolean {
  return !scoped && c.top_school_share !== null
    && (c.schools_with_spend <= 2 || c.top_school_share >= 0.8);
}
