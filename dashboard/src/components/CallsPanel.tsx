import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CallSummary } from "../lib/api";
import { fmtCost, fmtLatency, formatRelativeDate } from "../lib/format";
import StatTile from "./StatTile";
import ErrorState from "./ErrorState";

/** The level a panel sits on. Every level reads the same summary with
 *  the one whose-call rule (api/core/llm_attribution.py), so the number
 *  on a school, teacher, homework or student page is the number the Calls
 *  page shows for the same filter. */
export type CallsScope =
  | { kind: "school"; id: string }
  | { kind: "teacher"; id: string }
  | { kind: "student"; id: string }
  | { kind: "assignment"; id: string };

const WINDOWS = [
  { hours: 168, label: "7d" },
  { hours: 720, label: "30d" },
] as const;

// Spend-by-function bar: the biggest few by name, the rest as "other".
const BAR_SLOTS = 4;
const BAR_COLORS = ["var(--ink)", "#5b5548", "var(--accent)", "#8a5a12"];

/** `/llm-calls?…` for this scope and window. */
function callsHref(scope: CallsScope, hours: number, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ [scope.kind]: scope.id, hours: String(hours), ...extra });
  return `/llm-calls?${q.toString()}`;
}

/**
 * The calls panel — one component, scoped by the level it sits on: the
 * five numbers (calls, spend, failed, p50, p95 over successful calls with
 * their n), spend by function as one bar, the latest failures, and a way
 * into the Calls page pre-filtered to exactly this scope and window.
 */
export default function CallsPanel({ scope, title = "AI calls" }: { scope: CallsScope; title?: string }) {
  const [hours, setHours] = useState<number>(720);
  const [loaded, setLoaded] = useState<{ key: string; data: CallSummary } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const key = `${scope.kind}:${scope.id}:${hours}:${reload}`;

  useEffect(() => {
    let cancelled = false;
    api.llmCallsSummary({ [`${scope.kind}_id`]: scope.id, hours: String(hours) })
      .then((data) => { if (!cancelled) setLoaded({ key, data }); })
      .catch((e: Error) => { if (!cancelled) setFailed({ key, message: e.message }); });
    return () => { cancelled = true; };
  }, [scope.kind, scope.id, hours, key]);

  const data = loaded?.key === key ? loaded.data : null;
  const error = failed?.key === key ? failed.message : null;
  const win = WINDOWS.find((w) => w.hours === hours)?.label ?? `${hours}h`;

  return (
    <section className="calls-panel" aria-label={title}>
      <header className="calls-panel-head">
        <h2 className="section-head">{title}</h2>
        <div className="calls-panel-tools">
          <div className="segmented" role="group" aria-label="Window">
            {WINDOWS.map((w) => (
              <button
                key={w.hours} type="button"
                className={`segment${w.hours === hours ? " segment-active" : ""}`}
                aria-pressed={w.hours === hours}
                onClick={() => setHours(w.hours)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <Link className="calls-panel-all" to={callsHref(scope, hours)}>All calls →</Link>
        </div>
      </header>

      {error ? (
        <ErrorState message={error} onRetry={() => setReload((r) => r + 1)} />
      ) : !data ? (
        <p className="loading">Loading…</p>
      ) : (
        <PanelBody data={data} scope={scope} hours={hours} win={win} />
      )}
    </section>
  );
}

function PanelBody({ data, scope, hours, win }: { data: CallSummary; scope: CallsScope; hours: number; win: string }) {
  const errTone = data.failure_rate >= 5 ? "danger" : data.failed > 0 ? "warn" : "ok";
  const top = data.spend_by_function.slice(0, BAR_SLOTS);
  const rest = data.spend_by_function.slice(BAR_SLOTS).reduce((a, r) => a + r.spend, 0);
  const segments = [
    ...top.map((r, i) => ({ label: r.function, spend: r.spend, color: BAR_COLORS[i] })),
    ...(rest > 0 ? [{ label: "other", spend: rest, color: "var(--rule-strong, #cfc8b8)" }] : []),
  ].filter((s) => s.spend > 0);
  const pct = (v: number) => (data.spend > 0 ? Math.round((v / data.spend) * 100) : 0);

  return (
    <>
      <div className="tile-grid">
        <StatTile label="Calls" value={data.calls.toLocaleString()} sub={`last ${win}`} />
        <StatTile label="Spend" value={fmtCost(data.spend)} sub={`last ${win}`} />
        <StatTile
          label="Failed" tone={data.calls ? errTone : "default"} value={data.failed.toLocaleString()}
          sub={data.calls ? `${data.failure_rate}% of ${data.calls.toLocaleString()}` : "no calls"}
        />
        <StatTile label="p50" value={fmtLatency(data.latency_p50_ms)} sub="successful calls" />
        <StatTile
          label="p95" value={fmtLatency(data.latency_p95_ms)}
          sub={`successful calls · n=${data.latency_n.toLocaleString()}`}
        />
      </div>

      {segments.length > 0 && (
        <div className="calls-panel-spend">
          <div className="spend-bar" role="img" aria-label="Spend by function">
            {segments.map((s) => (
              <span key={s.label} style={{ flexGrow: s.spend, background: s.color }} title={`${s.label} ${fmtCost(s.spend)}`} />
            ))}
          </div>
          <ul className="spend-legend">
            {segments.map((s) => (
              <li key={s.label}>
                <i style={{ background: s.color }} />
                {s.label} <span>{pct(s.spend)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.latest_failures.length > 0 && (
        <div className="calls-panel-failures">
          <div className="calls-panel-subhead">
            <span>Latest failures</span>
            <Link to={callsHref(scope, hours, { status: "failed" })}>All failed →</Link>
          </div>
          <ul>
            {data.latest_failures.map((f) => (
              <li key={f.id}>
                <span className="cpf-when" title={new Date(f.created_at).toLocaleString()}>
                  {formatRelativeDate(f.created_at)}
                </span>
                <span className="cpf-fn">{f.function}</span>
                <span className="cpf-err">
                  {f.deleted_submission && <em>deleted submission · </em>}
                  {f.error ?? "no error recorded"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
