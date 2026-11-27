import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import StatTile from "../../components/StatTile";
import ErrorState from "../../components/ErrorState";
import { costsApi, type SpendBucket, type SpendData, type SpendGroup, type SpendRow } from "../../lib/costsApi";
import { BREAKDOWN_HOURS, barValue, bucketLabel, drillTo, isConcentrated, monthName, perCall, usd } from "./spendFormat";

/**
 * Spend — what we actually paid, where it went, and where the month is
 * heading. Every number comes from /admin/spend; this file only lays it
 * out. Each breakdown row drills into the debug level it names.
 */

const GROUPS: { key: SpendGroup; label: string }[] = [
  { key: "school", label: "School" },
  { key: "teacher", label: "Teacher" },
  { key: "student", label: "Student" },
  { key: "function", label: "Function" },
  { key: "model", label: "Model" },
];

const BUCKETS: { key: SpendBucket; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

// Past this many rows the tail folds into "everything else", which opens
// on click — a table of forty $0.01 students buries the five that matter.
const VISIBLE_ROWS = 8;

interface Props {
  scopeParams: Record<string, string>;
  includeInternal: boolean;
}

export default function SpendTab({ scopeParams, includeInternal }: Props) {
  const navigate = useNavigate();
  const [bucket, setBucket] = useState<SpendBucket>("week");
  const [group, setGroup] = useState<SpendGroup>("function");
  const [data, setData] = useState<SpendData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const scopeKey = JSON.stringify(scopeParams);
  useEffect(() => {
    let cancelled = false;
    costsApi
      .spend({
        ...JSON.parse(scopeKey),
        bucket,
        group_by: group,
        hours: String(BREAKDOWN_HOURS),
        include_internal: String(includeInternal),
      })
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [scopeKey, bucket, group, includeInternal, attempt]);

  // A new breakdown starts folded again.
  useEffect(() => setShowAll(false), [group]);

  const rows = useMemo(() => {
    if (!data) return { shown: [] as SpendRow[], rest: null as SpendRow | null };
    const all = data.rows;
    if (showAll || all.length <= VISIBLE_ROWS) return { shown: all, rest: null };
    const shown = all.slice(0, VISIBLE_ROWS - 1);
    const tail = all.slice(VISIBLE_ROWS - 1);
    const calls = tail.reduce((n, r) => n + r.calls, 0);
    const cost = tail.reduce((n, r) => n + r.cost, 0);
    return {
      shown,
      rest: {
        key: null, label: `everything else (${tail.length})`, calls, cost,
        share: tail.reduce((n, r) => n + r.share, 0),
        cost_per_call: calls ? cost / calls : null,
      },
    };
  }, [data, showAll]);

  if (error) return <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!data) return <p className="loading">Loading…</p>;

  const h = data.headline;
  const today = new Date();
  const monthLabel = monthName(h.month_start);
  const lastMonthLabel = monthName(
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)).toISOString().slice(0, 10),
  );
  // Render from what the response says it is, not the toggles: until a
  // new breakdown lands, the old rows must keep their own labels and links.
  const shownBucket = data.bucket;
  const shownGroup = data.group_by;
  const c = data.concentration;
  const concentrated = isConcentrated(c, "school_id" in scopeParams);
  const peak = Math.max(...data.series.map((p) => p.cost), 0);

  return (
    <div className="costs-spend">
      <div className="tile-grid">
        <StatTile
          label={`This month · ${monthLabel} 1–${today.getUTCDate()}`}
          value={usd(h.this_month)}
        />
        <StatTile label={`Last month · ${lastMonthLabel}`} value={usd(h.last_month)} />
        <StatTile
          label={`Projected ${monthLabel}`}
          value={usd(h.projected_month_end, 0)}
          sub={
            h.range_weeks >= 2
              ? `range ${usd(h.projected_low, 0)}–${usd(h.projected_high, 0)} · from weekly spread`
              : "run rate · too few full weeks for a range"
          }
        />
        <StatTile
          label="Last 30d vs prior 30d"
          value={h.change_30d_pct === null ? "—" : `${h.change_30d_pct > 0 ? "+" : ""}${Math.round(h.change_30d_pct)}%`}
          sub={`${usd(h.cost_30d)} vs ${usd(h.cost_prev_30d)}`}
        />
      </div>

      {concentrated && (
        <div className="costs-note" role="note">
          {c.schools_with_spend === 1 ? "One school" : `One of ${c.schools_with_spend} schools`}
          {c.top_school_name ? ` — ${c.top_school_name} —` : ""} drives{" "}
          {Math.round((c.top_school_share ?? 0) * 100)}% of spend. Treat projections as a run rate, not a forecast.
        </div>
      )}

      <section className="costs-section">
        <div className="costs-section-head">
          <h3>Spend per {shownBucket} · USD</h3>
          <div className="costs-toggle" role="group" aria-label="Bucket">
            {BUCKETS.map((b) => (
              <button
                key={b.key}
                type="button"
                aria-pressed={bucket === b.key}
                className={bucket === b.key ? "on" : ""}
                onClick={() => setBucket(b.key)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div className="costs-bars" role="img" aria-label={`Spend per ${shownBucket}`}>
          {data.series.map((p) => (
            <div
              key={p.start}
              className={`costs-bar${p.partial ? " partial" : ""}${p.cost === peak && peak > 0 ? " peak" : ""}`}
              title={`${bucketLabel(p.start, shownBucket)}: ${usd(p.cost)} · ${p.calls.toLocaleString()} calls${p.partial ? " (so far)" : ""}`}
            >
              <span className="costs-bar-value">{barValue(p.cost)}</span>
              <div className="costs-bar-fill" style={{ height: `${peak ? (p.cost / peak) * 100 : 0}%` }} />
            </div>
          ))}
        </div>
        <div className="costs-bar-axis">
          {data.series.map((p) => (
            <span key={p.start}>{bucketLabel(p.start, shownBucket)}{p.partial ? "*" : ""}</span>
          ))}
        </div>
        <p className="costs-foot">* still filling.</p>
      </section>

      <section className="costs-section">
        <div className="costs-section-head">
          <h3>Breakdown · last 30 days</h3>
          <div className="costs-toggle" role="group" aria-label="Break down by">
            {GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                aria-pressed={group === g.key}
                className={group === g.key ? "on" : ""}
                onClick={() => setGroup(g.key)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        {data.rows.length === 0 ? (
          <p className="costs-empty">No spend in the last 30 days.</p>
        ) : (
          <table className="costs-table">
            <thead>
              <tr>
                <th>{GROUPS.find((g) => g.key === shownGroup)?.label}</th>
                <th className="num">Calls</th>
                <th className="num">Spend</th>
                <th className="num">Share</th>
                <th className="num">$/call</th>
              </tr>
            </thead>
            <tbody>
              {rows.shown.map((r) => {
                const to = drillTo(r, shownGroup);
                return (
                  // The link is the keyboard and screen-reader target; the
                  // row's click just widens it for the mouse.
                  <tr
                    key={r.key ?? r.label}
                    className={to ? "drill" : "muted"}
                    onClick={to ? () => navigate(to) : undefined}
                  >
                    <td className={shownGroup === "function" || shownGroup === "model" ? "mono" : ""}>
                      {to ? <Link to={to} onClick={(e) => e.stopPropagation()}>{r.label}</Link> : r.label}
                    </td>
                    <td className="num">{r.calls.toLocaleString()}</td>
                    <td className="num">{usd(r.cost)}</td>
                    <td className="num">{Math.round(r.share * 100)}%</td>
                    <td className="num">{perCall(r.cost_per_call)}</td>
                  </tr>
                );
              })}
              {rows.rest && (
                <tr className="drill" onClick={() => setShowAll(true)}>
                  <td>
                    <button type="button" className="costs-rest" aria-expanded={false}
                      onClick={(e) => { e.stopPropagation(); setShowAll(true); }}>
                      {rows.rest.label}
                    </button>
                  </td>
                  <td className="num">{rows.rest.calls.toLocaleString()}</td>
                  <td className="num">{usd(rows.rest.cost)}</td>
                  <td className="num">{Math.round(rows.rest.share * 100)}%</td>
                  <td className="num">{perCall(rows.rest.cost_per_call)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {(shownGroup === "teacher" || shownGroup === "student") && (
          <p className="costs-foot">
            A student&rsquo;s graded work counts for the student and for their teacher, so these rows
            can add up to more than {usd(data.total_cost)}.
          </p>
        )}
      </section>
    </div>
  );
}
