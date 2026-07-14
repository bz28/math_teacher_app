import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { api, type QualityData, type QualityBucket, type QualityScoreRow } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import { windowLabel } from "../lib/definitions";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import { Checkbox } from "../components/Checkbox";
import { Pagination } from "../components/Pagination";
import ErrorState from "../components/ErrorState";
import { MetaChip } from "../components/MetaChip";
import { SUBJECT_LABEL, MODE_LABEL } from "../lib/quality";

const PAGE_SIZE = 25;

// Pass rate is the health headline — tone it like a status light.
function rateTone(rate: number): "ok" | "warn" | "danger" | "default" {
  if (rate >= 90) return "ok";
  if (rate >= 75) return "default";
  if (rate >= 60) return "warn";
  return "danger";
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 4 ? "var(--ok)" : score >= 3 ? "var(--warn)" : "var(--danger)";
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500, color }}>{score}</span>
  );
}

/** One breakdown table (by subject or by mode). Rows arrive worst-first
 *  from the backend; the pass-rate bar makes the weak buckets pop. */
function BreakdownTable({
  title, rows, labelOf,
}: {
  title: "Subject" | "Mode";
  rows: QualityBucket[];
  labelOf: (name: string) => string;
}) {
  const maxEval = Math.max(1, ...rows.map((r) => r.evaluated));
  const kind = title === "Subject" ? "subject" : "mode";
  const cols: Column<QualityBucket>[] = [
    {
      key: "name", header: title, width: "34%",
      sortValue: (b) => b.name,
      render: (b) => <MetaChip label={labelOf(b.name)} kind={kind} value={b.name} />,
    },
    {
      key: "pass_rate", header: "Pass rate", width: "42%",
      sortValue: (b) => b.pass_rate,
      render: (b) => {
        const tone = rateTone(b.pass_rate);
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, height: 7, background: "var(--paper-2)", overflow: "hidden" }}>
              <div style={{
                width: `${b.pass_rate}%`, height: "100%",
                background: `var(--${tone === "default" ? "ink" : tone})`,
                minWidth: b.pass_rate > 0 ? 2 : 0,
              }} />
            </div>
            <span className="num" style={{ fontSize: 13, minWidth: 44, textAlign: "right" }}>
              {b.pass_rate}%
            </span>
          </div>
        );
      },
    },
    {
      key: "avg_score", header: "Avg", numeric: true, width: "12%",
      sortValue: (b) => b.avg_score,
      render: (b) => <span className="num">{b.avg_score.toFixed(1)}</span>,
    },
    {
      key: "evaluated", header: "n", numeric: true, width: "12%",
      sortValue: (b) => b.evaluated,
      render: (b) => (
        <span title={`${b.evaluated} evaluated`} style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
          <span aria-hidden style={{
            width: `${8 + (b.evaluated / maxEval) * 18}px`, height: 3,
            background: "var(--muted-2)", display: "inline-block",
          }} />
          <span className="num" style={{ color: "var(--muted)", fontSize: 12 }}>{b.evaluated}</span>
        </span>
      ),
    },
  ];
  return (
    <div className="table-card" style={{ flex: 1, minWidth: 320 }}>
      <h3>Quality by {kind}</h3>
      <DataTable
        columns={cols}
        rows={rows}
        rowKey={(b) => b.name}
        rowStatus={(b) => (b.pass_rate < 60 ? "var(--danger)" : b.pass_rate < 75 ? "var(--warn)" : undefined)}
        minWidth={340}
        empty={<span className="dt-state-title">No {kind} data in this window.</span>}
      />
    </div>
  );
}

export default function Quality() {
  const navigate = useNavigate();
  const [data, setData] = useState<QualityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hours, setHours] = useState("168");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    // Guard against a slow earlier request resolving after a newer one
    // and overwriting the view with data for a stale filter/page.
    let cancelled = false;
    api
      .quality({
        hours,
        only_failed: onlyFailed ? "true" : "",
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load solution quality."); });
    return () => { cancelled = true; };
  }, [hours, onlyFailed, offset, reloadKey]);

  const handleHoursChange = (v: string) => { setHours(v); setOffset(0); };
  const handleFailedToggle = (v: boolean) => { setOnlyFailed(v); setOffset(0); };

  if (!data && error) {
    return <ErrorState message={error} onRetry={() => { setError(null); setReloadKey((k) => k + 1); }} />;
  }
  if (!data) return <p className="loading">Loading…</p>;

  const { summary } = data;
  const win = windowLabel(Number(hours));

  // Delta vs the prior equal-length window — relative % change of the
  // pass rate, so the tile's "%" reads correctly. Omitted when the prior
  // window had no passes (the ratio is undefined) or no data at all.
  const delta = summary.prior_total > 0 && summary.prior_pass_rate > 0
    ? {
        pct: ((summary.pass_rate - summary.prior_pass_rate) / summary.prior_pass_rate) * 100,
        goodWhen: "up" as const,
        note: `vs prev ${win}`,
      }
    : undefined;

  const dims = [
    { label: "Correctness", value: summary.avg_correctness },
    { label: "Optimality", value: summary.avg_optimality },
    { label: "Clarity", value: summary.avg_clarity },
    { label: "Flow", value: summary.avg_flow },
  ];

  const healthTone = rateTone(summary.pass_rate);

  const scoreCols: Column<QualityScoreRow>[] = [
    {
      key: "problem", header: "Problem", width: "42%",
      render: (s) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {s.problem}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 5, alignItems: "center", flexWrap: "wrap" }}>
            <MetaChip label={SUBJECT_LABEL[s.subject] ?? s.subject} kind="subject" value={s.subject} />
            <MetaChip label={MODE_LABEL[s.mode] ?? s.mode} kind="mode" value={s.mode} />
            {!s.passed && s.issues && (
              <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 280 }}>
                {s.issues}
              </span>
            )}
          </div>
        </div>
      ),
    },
    { key: "correctness", header: "Corr", numeric: true, width: "8%", sortValue: (s) => s.correctness, render: (s) => <ScoreBadge score={s.correctness} /> },
    { key: "optimality", header: "Opt", numeric: true, width: "8%", sortValue: (s) => s.optimality, render: (s) => <ScoreBadge score={s.optimality} /> },
    { key: "clarity", header: "Clar", numeric: true, width: "8%", sortValue: (s) => s.clarity, render: (s) => <ScoreBadge score={s.clarity} /> },
    { key: "flow", header: "Flow", numeric: true, width: "8%", sortValue: (s) => s.flow, render: (s) => <ScoreBadge score={s.flow} /> },
    {
      key: "passed", header: "Verdict", width: "12%", align: "center",
      sortValue: (s) => (s.passed ? 1 : 0),
      render: (s) => <StatusPill tone={s.passed ? "ok" : "danger"} label={s.passed ? "PASS" : "FAIL"} />,
    },
    {
      key: "created_at", header: "When", numeric: true, width: "14%",
      sortValue: (s) => new Date(s.created_at).getTime(),
      render: (s) => (
        <span title={new Date(s.created_at).toLocaleString()} style={{ color: "var(--muted)", fontSize: 12.5 }}>
          {formatRelativeDate(s.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Diagnostic</span>
          <h1>Solution quality</h1>
          <p>How good the AI-generated solutions are — an LLM judge scores a sample of solver runs. Always read the score next to its sample size.</p>
        </div>
        <StatusPill
          tone={healthTone === "danger" ? "danger" : healthTone === "warn" ? "warn" : "ok"}
          label={summary.pass_rate >= 75 ? "HEALTHY" : summary.pass_rate >= 60 ? "SLIPPING" : "WEAK"}
        />
      </div>

      <div className="filters">
        <select value={hours} onChange={(e) => handleHoursChange(e.target.value)}>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
          <option value="2160">Last 90 days</option>
        </select>
        <Checkbox checked={onlyFailed} onChange={handleFailedToggle} label="Failing only (list)" />
      </div>

      {/* ── ① Headline band ─────────────────────────────────────────── */}
      <div className="tile-grid">
        <StatTile
          label="Pass rate"
          tone={healthTone}
          value={<span style={{ fontSize: 44, letterSpacing: -1 }}>{summary.pass_rate}%</span>}
          delta={delta}
          sub={`${summary.passed}/${summary.total} solutions cleared the bar · ${win}`}
          spark={data.trend.map((t) => t.pass_rate)}
        />
        <StatTile
          label="Evaluated"
          value={summary.total.toLocaleString()}
          sub={`${summary.coverage_pct}% of ${summary.total_sessions.toLocaleString()} sessions sampled · ${win}`}
        />
        <StatTile
          label="Failing now"
          tone={summary.failed > 0 ? "danger" : "ok"}
          value={summary.failed.toLocaleString()}
          sub={summary.failed > 0 ? "solutions scored below the bar" : "no failures in this window"}
        />
      </div>

      {/* ── ② Trend (primary visual) ────────────────────────────────── */}
      <div className="chart-card">
        <h3>Pass rate over time</h3>
        {data.trend.length > 1 ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.trend}>
              <CartesianGrid strokeDasharray="2 4" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis unit="%" domain={[0, 100]} />
              <Tooltip
                formatter={(v, _n, p) => [`${Number(v).toFixed(1)}% · ${p?.payload?.evaluated ?? 0} evaluated`, "Pass rate"]}
              />
              <Area type="monotone" dataKey="pass_rate" stroke="#4a6b3a" fill="#4a6b3a1a" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="empty-mini">Not enough history yet to plot a trend.</p>
        )}
      </div>

      {/* Compact dimension strip — the 4 averages, not a full chart. */}
      <div style={{
        display: "flex", gap: 28, marginBottom: 28, padding: "16px 0",
        borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)",
        flexWrap: "wrap", alignItems: "center",
      }}>
        <h3 style={{ marginBottom: 0, whiteSpace: "nowrap" }}>Avg by dimension</h3>
        {dims.map((d) => (
          <div key={d.label} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>{d.label}</span>
            <span className="num" style={{
              fontSize: 17,
              color: d.value >= 4 ? "var(--ok)" : d.value >= 3 ? "var(--warn)" : "var(--danger)",
            }}>
              {d.value.toFixed(1)}
            </span>
            <span style={{ fontSize: 11, color: "var(--muted-2)" }}>/5</span>
          </div>
        ))}
      </div>

      {/* ── Breakdown by subject + mode ─────────────────────────────── */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 28 }}>
        <BreakdownTable title="Subject" rows={data.by_subject} labelOf={(n) => SUBJECT_LABEL[n] ?? n} />
        <BreakdownTable title="Mode" rows={data.by_mode} labelOf={(n) => MODE_LABEL[n] ?? n} />
      </div>

      {/* ── ③ Evaluations (worst-first, drill into the bad ones) ────── */}
      <div className="table-card">
        <h3>
          Evaluations — worst first
          <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 13 }}>
            {" · "}{data.total_count.toLocaleString()}{onlyFailed ? " failing" : ""}
          </span>
        </h3>
        <DataTable
          columns={scoreCols}
          rows={data.scores}
          rowKey={(s) => s.id}
          onRowClick={(s) => navigate(`/quality/${s.session_id}`)}
          rowStatus={(s) => (s.passed ? undefined : "var(--danger)")}
          drill
          minWidth={720}
          empty={<span className="dt-state-title">{onlyFailed ? "No failing solutions in this window." : "No evaluations in this window."}</span>}
        />
        <Pagination offset={offset} limit={PAGE_SIZE} total={data.total_count} onChange={setOffset} />
      </div>
    </div>
  );
}
