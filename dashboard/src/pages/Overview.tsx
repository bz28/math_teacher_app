import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { api, type OverviewData } from "../lib/api";
import StatCard from "../components/StatCard";

const MODE_COLORS: Record<string, string> = {
  learn: "#14130f",
  practice: "#4a6b3a",
  mock_test: "#b8431a",
};

const SUBJECT_COLORS: Record<string, string> = {
  math: "#14130f",
  chemistry: "#4a6b3a",
};

function HealthBadge({ errorRate, latency }: { errorRate: number; latency: number }) {
  const isDegraded = errorRate >= 5 || latency >= 5000;
  const isDown = errorRate >= 20;

  const dotClass = isDown ? "dot-danger" : isDegraded ? "dot-warn" : "dot-ok";
  const label = isDown ? "Unhealthy" : isDegraded ? "Degraded" : "Healthy";

  return (
    <span className="list-row-status" style={{ fontSize: 13 }}>
      <span aria-hidden="true" className={`dot ${dotClass}`}>●</span>
      {label}
    </span>
  );
}

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [hours, setHours] = useState("24");
  const [grade, setGrade] = useState("");

  useEffect(() => {
    const fetch = () => api.overview({ hours, grade }).then(setData);
    fetch();
    const interval = setInterval(fetch, 30_000);
    return () => clearInterval(interval);
  }, [hours, grade]);

  if (!data) return <p className="loading">Loading…</p>;

  const modeMap = Object.fromEntries(data.by_mode.map((m) => [m.mode, m.count]));
  const latencyStr = data.avg_latency_ms >= 1000
    ? `${(data.avg_latency_ms / 1000).toFixed(1)}s`
    : `${Math.round(data.avg_latency_ms)}ms`;

  return (
    <div className="platform-overview">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Diagnostic</span>
          <h1>Overview</h1>
          <p>System health and usage at a glance.</p>
        </div>
        <HealthBadge errorRate={data.error_rate} latency={data.avg_latency_ms} />
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

      <div className="stat-grid">
        <StatCard label="Sessions" value={data.total_sessions} />
        <StatCard label="Total Cost" value={`$${data.total_cost.toFixed(2)}`} />
        <StatCard label="Active Users" value={data.active_users} />
        <StatCard label="New Users" value={data.new_users} />
        <StatCard label="Total Users" value={data.total_users} sub="All time" />
        <StatCard label="Deleted Accounts" value={data.deleted_accounts} sub="All time" />
        <StatCard label="Avg Latency" value={latencyStr} />
        <StatCard
          label="Error Rate"
          value={
            <span style={{ color: data.error_rate >= 5 ? "var(--danger)" : data.error_rate > 0 ? "var(--warn)" : "var(--ok)" }}>
              {data.error_rate}%
            </span>
          }
          sub={`${data.failed_calls} failed / ${data.total_calls} total`}
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

      {data.top_spenders.length > 0 && (
        <div className="table-card">
          <h3>Top Spenders</h3>
          <table>
            <colgroup>
              <col style={{ width: "70%" }} />
              <col style={{ width: "30%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>User</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.top_spenders.map((s, i) => (
                <tr key={i}>
                  <td>{s.name}</td>
                  <td style={{ fontWeight: 600 }}>${s.total_cost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
