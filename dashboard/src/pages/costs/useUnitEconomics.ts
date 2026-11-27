import { useEffect, useState } from "react";
import { costsApi, type UnitEconomicsData } from "../../lib/costsApi";

/**
 * /admin/unit-economics for the Unit costs and Margin tabs. `days` empty =
 * the server's default window, since the configured model's cutover.
 * Stale data stays on screen while a refetch is in flight, so moving a
 * filter doesn't flash "Loading…".
 */
export function useUnitEconomics(
  scopeParams: Record<string, string>,
  includeInternal: boolean,
  days: string,
) {
  const [data, setData] = useState<UnitEconomicsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const scopeKey = JSON.stringify(scopeParams);

  useEffect(() => {
    let cancelled = false;
    const q: Record<string, string> = {
      ...JSON.parse(scopeKey),
      exclude_internal: String(!includeInternal),
    };
    if (days) q.days = days;
    costsApi
      .unitEconomics(q)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [scopeKey, includeInternal, days, attempt]);

  return { data, error, retry: () => setAttempt((n) => n + 1) };
}

export const WINDOWS = [
  { value: "", label: "Since the model cutover" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
] as const;

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
