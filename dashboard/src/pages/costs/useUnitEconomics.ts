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
  // The data and the request it answers, kept together: the heading and
  // the busy cue read off what's on screen, not what was just asked for.
  const [loaded, setLoaded] = useState<{ data: UnitEconomicsData; key: string; days: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const scopeKey = JSON.stringify(scopeParams);
  const key = `${scopeKey}|${includeInternal}|${days}`;

  useEffect(() => {
    let cancelled = false;
    const q: Record<string, string> = {
      ...JSON.parse(scopeKey),
      exclude_internal: String(!includeInternal),
    };
    if (days) q.days = days;
    costsApi
      .unitEconomics(q)
      .then((d) => { if (!cancelled) { setLoaded({ data: d, key: `${scopeKey}|${includeInternal}|${days}`, days }); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [scopeKey, includeInternal, days, attempt]);

  return {
    data: loaded?.data ?? null,
    loadedDays: loaded?.days ?? "",
    stale: loaded !== null && loaded.key !== key,
    error,
    retry: () => setAttempt((n) => n + 1),
  };
}
