/**
 * The Unit costs / Margin window: which ones the picker offers, and how a
 * `days` value from the URL is read. Pure, so `npm test` pins it.
 */
import type { UnitEconomicsData } from "../../lib/costsApi.ts";

export const WINDOWS = [
  { value: "", label: "Since the model cutover" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
] as const;

/** A `days` the picker offers, else the default. `days=abc` or `days=0`
 *  would 422 and strand the page on an error whose Retry repeats it; an
 *  unlisted `days=5` would load under a picker showing another label. */
export function windowDays(raw: string | null): string {
  return WINDOWS.some((w) => w.value === raw) ? (raw as string) : "";
}

/** "since Opus 5.5 cutover (Nov 4)" / "last 30 days" — the section heading's tail. */
export function windowLabel(d: UnitEconomicsData, days: string, modelLabel: (id: string) => string): string {
  if (days) return `last ${days} days`;
  const start = new Date(d.window.start).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
  return d.window.cutover_model
    ? `since ${modelLabel(d.window.cutover_model)} cutover (${start})`
    : `since ${start}`;
}
