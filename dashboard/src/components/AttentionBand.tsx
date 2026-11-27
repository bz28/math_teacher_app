import { useEffect, useState } from "react";
import { api, type AttentionItem } from "../lib/api";
import { fmtLatency } from "../lib/format";
import { scopeParams } from "../lib/useSelectedSchool";

/**
 * "Needs you" — the top of the Calls page. What on the AI side is failing
 * or slowing in the last 24 hours (rules: api/routes/admin_llm_attention.py),
 * each line a button into the calls behind it. Quiet when nothing is
 * wrong: a calm one-liner, not an empty box.
 */
export default function AttentionBand({
  schoolId, placeLabel, onFunction, onSchool,
}: {
  schoolId: string | null;
  /** The place the band counts — named on the band, since on a page
   *  filtered to one person nothing else on screen says it. */
  placeLabel: string;
  /** Open one function's calls over the last 24h — its failures only
   *  when the line is about failing, all of them when it's about speed. */
  onFunction: (fn: string, failedOnly: boolean) => void;
  onSchool: (schoolId: string) => void;
}) {
  const [loaded, setLoaded] = useState<{ key: string; items: AttentionItem[] } | null>(null);
  const key = schoolId ?? "all";

  useEffect(() => {
    let cancelled = false;
    api.llmCallsAttention(scopeParams(schoolId))
      .then((r) => { if (!cancelled) setLoaded({ key, items: r.items }); })
      // The band is a pointer, not the page: if it can't load, the table
      // below still answers everything, so it stays out of the way.
      .catch(() => { if (!cancelled) setLoaded({ key, items: [] }); });
    return () => { cancelled = true; };
  }, [schoolId, key]);

  const items = loaded?.key === key ? loaded.items : null;
  if (items === null) return <div className="attention-band attention-pending" aria-hidden />;
  if (items.length === 0) {
    return (
      <div className="attention-band attention-calm" role="status">
        <strong>All clear</strong>
        <span className="attention-place">{placeLabel} · 24h</span>
        <span>No function failing, no school with failed calls, no latency jump.</span>
      </div>
    );
  }
  return (
    <div className="attention-band attention-alert" role="region" aria-label="Needs you">
      <strong>Needs you</strong>
      <span className="attention-place">{placeLabel} · 24h</span>
      <ul>
        {items.map((it) => (
          <li key={itemKey(it)}>
            <button type="button" onClick={() => {
              if (it.kind === "school_failures") onSchool(it.school_id);
              else onFunction(it.function, it.kind === "function_failing");
            }}>
              {describe(it)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function itemKey(it: AttentionItem): string {
  return it.kind === "school_failures" ? `school:${it.school_id}` : `${it.kind}:${it.function}`;
}

function describe(it: AttentionItem) {
  switch (it.kind) {
    case "function_failing":
      return <><b>{it.function}</b> failing {it.failed} of last {it.of}</>;
    case "school_failures":
      return <><b>{it.school_name}</b> · {it.failed} failed calls</>;
    case "p95_up":
      return <><b>{it.function}</b> p95 up to {fmtLatency(it.p95_ms)} (was {fmtLatency(it.was_ms)})</>;
  }
}
