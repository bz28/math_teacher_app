import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { api, type OverviewData, type SchoolListItem } from "../lib/api";
import { fmtCost } from "../lib/format";
import { STALE_AFTER_DAYS, isAtRisk, windowLabel } from "../lib/definitions";
import StatTile from "../components/StatTile";
import StatusPill, { type PillTone } from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import ErrorState from "../components/ErrorState";

const MODE_COLORS: Record<string, string> = {
  learn: "#14130f",
  practice: "#4a6b3a",
  mock_test: "#b8431a",
};

const SUBJECT_COLORS: Record<string, string> = {
  math: "#14130f",
  chemistry: "#4a6b3a",
};

const HARNESS_WINDOW_DAYS = 7;

// Health rollup — the same thresholds the old badge used, now expressed
// as a StatusPill so the one status system covers the page header too.
function healthPill(errorRate: number, latency: number): { tone: PillTone; label: string } {
  if (errorRate >= 20) return { tone: "danger", label: "UNHEALTHY" };
  if (errorRate >= 5 || latency >= 5000) return { tone: "warn", label: "DEGRADED" };
  return { tone: "ok", label: "HEALTHY" };
}

interface AttentionItem {
  id: string;
  severity: "danger" | "warn";
  to: string;
  node: ReactNode;
}

interface TopSpender { name: string; email: string | null; total_cost: number }

export default function Overview() {
  const navigate = useNavigate();
  const [data, setData] = useState<OverviewData | null>(null);
  const [schools, setSchools] = useState<SchoolListItem[]>([]);
  const [failedRuns, setFailedRuns] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hours, setHours] = useState("24");
  const [grade, setGrade] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.overview({ hours, grade })
        .then((d) => { if (!cancelled) { setData(d); setError(null); } })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load overview."); });
      // Enrichers for the attention band. Best-effort: a failure here
      // must never blank the page, so they own their own state and
      // swallow errors — the band just omits that signal.
      api.schools()
        .then((r) => { if (!cancelled) setSchools(r.schools); })
        .catch(() => {});
      api.harnessRuns({ limit: "200" })
        .then((r) => {
          if (cancelled) return;
          const cutoff = Date.now() - HARNESS_WINDOW_DAYS * 86_400_000;
          setFailedRuns(
            r.runs.filter((x) => !x.passed && new Date(x.created_at).getTime() >= cutoff).length,
          );
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [hours, grade, reloadKey]);

  const atRiskSchools = useMemo(
    () => schools.filter((s) => s.is_active && isAtRisk({ lastActiveAt: s.last_activity_at })).length,
    [schools],
  );

  const win = windowLabel(Number(hours));

  const attention: AttentionItem[] = useMemo(() => {
    if (!data) return [];
    const items: AttentionItem[] = [];
    if (data.error_rate >= 5) {
      items.push({
        id: "error-rate", severity: "danger", to: "/llm-calls",
        node: <>Error rate is <b>{data.error_rate}%</b> — {data.failed_calls}/{data.total_calls} AI calls failing ({win})</>,
      });
    } else if (data.failed_calls > 0) {
      items.push({
        id: "failed-calls", severity: "warn", to: "/llm-calls",
        node: <><b>{data.failed_calls}</b> AI call{data.failed_calls === 1 ? "" : "s"} failed in the last {win}</>,
      });
    }
    if (atRiskSchools > 0) {
      items.push({
        id: "at-risk-schools", severity: "warn", to: "/schools",
        node: <><b>{atRiskSchools}</b> active school{atRiskSchools === 1 ? "" : "s"} at risk — quiet {STALE_AFTER_DAYS}+ days</>,
      });
    }
    if (failedRuns > 0) {
      items.push({
        id: "harness", severity: "warn", to: "/harness-runs",
        node: <><b>{failedRuns}</b> harness run{failedRuns === 1 ? "" : "s"} failing in the last {HARNESS_WINDOW_DAYS}d</>,
      });
    }
    // Danger before warn so the worst thing is always on top.
    return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "danger" ? -1 : 1));
  }, [data, atRiskSchools, failedRuns, win]);

  // Only surface the error panel when there's nothing to show. A blip
  // during 30s polling keeps the last-good view rather than yanking it.
  if (!data && error) {
    return <ErrorState message={error} onRetry={() => { setError(null); setReloadKey((k) => k + 1); }} />;
  }
  if (!data) return <p className="loading">Loading…</p>;

  const modeMap = Object.fromEntries(data.by_mode.map((m) => [m.mode, m.count]));
  const fmtLatency = (ms: number) =>
    ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  // p95 leads the tile: an average hides the slow tail that actually
  // hurts users. Avg is kept as a secondary reference in the subline.
  const latencyStr = fmtLatency(data.p95_latency_ms);
  const errTone = data.error_rate >= 5 ? "danger" : data.error_rate > 0 ? "warn" : "ok";
  const dailyRate = Number(hours) > 0 ? data.total_cost / (Number(hours) / 24) : 0;
  const health = healthPill(data.error_rate, data.avg_latency_ms);

  const spenderCols: Column<TopSpender>[] = [
    {
      key: "user", header: "User", width: "70%",
      render: (s) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink)", fontWeight: 500 }}>{s.name}</div>
          {s.email && s.email !== s.name && (
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{s.email}</div>
          )}
        </div>
      ),
    },
    {
      key: "cost", header: `Cost (${win})`, numeric: true, width: "30%",
      sortValue: (s) => s.total_cost,
      render: (s) => <span style={{ color: "var(--ink)", fontWeight: 600 }}>{fmtCost(s.total_cost)}</span>,
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Diagnostic</span>
          <h1>Overview</h1>
          <p>What needs you right now — health, cost, and the customers slipping.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusPill tone="live" label="LIVE" pulse title="Auto-refreshes every 30s" />
          <StatusPill tone={health.tone} label={health.label} />
        </div>
      </div>

      <div className="filters" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <select value={hours} onChange={(e) => setHours(e.target.value)}>
          <option value="1">Last hour</option>
          <option value="6">Last 6 hours</option>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
          <option value="87600">All time</option>
        </select>
        <select value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="">All Grades</option>
          <option value="2">K-2</option>
          <option value="5">3-5</option>
          <option value="8">6-8</option>
          <option value="12">9-12</option>
          <option value="16">College</option>
        </select>
        {grade && (
          <button className="filter-badge" onClick={() => setGrade("")} style={{ cursor: "pointer", border: "none" }}>
            Grade filter ✕
          </button>
        )}
      </div>

      {/* ── Attention band — the hero "what's broken" element ──────── */}
      {attention.length === 0 ? (
        <div className="attention attention-clear">
          <div className="attention-head">
            <div className="attention-title attention-title-clear">
              <StatusPill tone="ok" label="ALL CLEAR" />
              Nothing needs you
            </div>
            <span className="attention-clear-sub">No failing calls, at-risk schools, or harness failures in this window.</span>
          </div>
        </div>
      ) : (
        <div className={`attention${attention.some((a) => a.severity === "danger") ? " attention-alert" : ""}`}>
          <div className="attention-head">
            <div className="attention-title">
              {attention.length} thing{attention.length === 1 ? "" : "s"} need you
            </div>
            {/* No aggregate window label here: items span different
                windows (error 24h, at-risk 14d, harness 7d) and each
                carries its own inline. */}
            <span className="attention-count">sorted by severity</span>
          </div>
          <ul className="attention-list">
            {attention.map((item) => (
              <li key={item.id}>
                <button className="attention-item" onClick={() => navigate(item.to)}>
                  <span className={`attention-item-bar attention-item-bar-${item.severity}`} />
                  <span className="attention-item-text">{item.node}</span>
                  <span aria-hidden="true" className="attention-item-arrow">→</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Health tiles — the founder's headline numbers ─────────── */}
      <div className="tile-grid">
        <StatTile
          label="Error rate"
          tone={errTone}
          value={`${data.error_rate}%`}
          sub={`${data.failed_calls}/${data.total_calls} calls · ${win}`}
        />
        <StatTile
          label="p95 latency"
          value={latencyStr}
          sub={`avg ${fmtLatency(data.avg_latency_ms)} · successful calls · ${win}`}
        />
        <StatTile
          label={`Cost (${win})`}
          value={fmtCost(data.total_cost)}
          sub={`≈ ${fmtCost(dailyRate)}/day run-rate`}
          spark={data.cost_by_day.map((d) => d.cost)}
        />
      </div>

      {/* ── Cost attribution — who's spending ─────────────────────── */}
      <div className="table-card">
        <h3>Top spenders · {win}</h3>
        <DataTable
          columns={spenderCols}
          rows={data.top_spenders as TopSpender[]}
          rowKey={(s) => s.email ?? s.name}
          defaultSort={{ key: "cost", dir: "desc" }}
          empty={<span className="dt-state-title">No spend in this window.</span>}
          minWidth={360}
        />
      </div>

      <div className="chart-row">
        <div className="chart-card">
          <h3>Sessions / day</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.sessions_by_day}>
              <CartesianGrid strokeDasharray="2 4" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="count" stroke="#14130f" fill="#14130f1a" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Cost / day ($)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.cost_by_day}>
              <CartesianGrid strokeDasharray="2 4" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip formatter={(v) => `$${Number(v).toFixed(4)}`} />
              <Area type="monotone" dataKey="cost" stroke="#b8431a" fill="#b8431a1a" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{
        display: "flex", gap: 28, marginBottom: 28, padding: "18px 0",
        borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)",
        flexWrap: "wrap", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <h3 style={{ marginBottom: 0, whiteSpace: "nowrap" }}>By mode</h3>
          {["learn", "practice", "mock_test"].map((mode) => (
            <div key={mode} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 7, height: 7, background: MODE_COLORS[mode] }} />
              <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                {mode === "mock_test" ? "Mock test" : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </span>
              <span className="num" style={{ fontSize: 13, color: "var(--ink)" }}>{modeMap[mode] ?? 0}</span>
            </div>
          ))}
        </div>
        <div style={{ width: 1, height: 24, background: "var(--rule)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <h3 style={{ marginBottom: 0, whiteSpace: "nowrap" }}>By subject</h3>
          {data.by_subject.map((s) => (
            <div key={s.subject} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 7, height: 7, background: SUBJECT_COLORS[s.subject] ?? "var(--muted-2)" }} />
              <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                {s.subject.charAt(0).toUpperCase() + s.subject.slice(1)}
              </span>
              <span className="num" style={{ fontSize: 13, color: "var(--ink)" }}>{s.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Usage — demoted below the fold. Deleted-accounts vanity
             metric dropped entirely. ─────────────────────────────── */}
      <div className="overview-section">Usage · {win}</div>
      <div className="mini-metrics">
        <div className="mini-metric">
          <span className="mini-metric-label">Sessions</span>
          <span className="mini-metric-value">{data.total_sessions.toLocaleString()}</span>
        </div>
        <div className="mini-metric">
          <span className="mini-metric-label">Active users</span>
          <span className="mini-metric-value">{data.active_users.toLocaleString()}</span>
        </div>
        <div className="mini-metric">
          <span className="mini-metric-label">New users</span>
          <span className="mini-metric-value">{data.new_users.toLocaleString()}</span>
        </div>
        <div className="mini-metric">
          <span className="mini-metric-label">Total users (all-time)</span>
          <span className="mini-metric-value">{data.total_users.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
