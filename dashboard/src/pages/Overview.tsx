import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { api, type OverviewData } from "../lib/api";
import StatCard from "../components/StatCard";

const MODE_COLORS: Record<string, string> = {
  learn: "#6366f1",
  practice: "#10b981",
  mock_test: "#f59e0b",
};

const SUBJECT_COLORS: Record<string, string> = {
  math: "#6366f1",
  chemistry: "#10b981",
};

function HealthBadge({ errorRate, latency }: { errorRate: number; latency: number }) {
  const isDegraded = errorRate >= 5 || latency >= 5000;
  const isDown = errorRate >= 20;

  const color = isDown ? "#ef4444" : isDegraded ? "#f59e0b" : "#10b981";
  const label = isDown ? "Unhealthy" : isDegraded ? "Degraded" : "Healthy";

  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "6px 14px", borderRadius: 20,
      background: `${color}15`, border: `1px solid ${color}30`,
      fontSize: 13, fontWeight: 600, color,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: 4, background: color,
        boxShadow: `0 0 6px ${color}80`,
      }} />
      {label}
    </div>
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

  if (!data) return <p>Loading...</p>;

  const modeMap = Object.fromEntries(data.by_mode.map((m) => [m.mode, m.count]));
  const latencyStr = data.avg_latency_ms >= 1000
    ? `${(data.avg_latency_ms / 1000).toFixed(1)}s`
    : `${Math.round(data.avg_latency_ms)}ms`;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Overview</h1>
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>System health and usage at a glance</p>
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
        <StatCard
          label="Deleted Accounts"
          value={data.deleted_accounts}
          sub="all time"
        />
        <StatCard label="Avg Latency" value={latencyStr} />
        <StatCard
          label="Error Rate"
          value={
            <span style={{ color: data.error_rate >= 5 ? "#ef4444" : data.error_rate > 0 ? "#f59e0b" : "#10b981" }}>
              {data.error_rate}%
            </span>
          }
          sub={`${data.failed_calls} failed / ${data.total_calls} total`}
        />
      </div>

      <div className="chart-row">
        <div className="chart-card">
          <h3>Sessions / Day</h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={data.sessions_by_day}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="count" stroke="#6366f1" fill="#6366f140" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Cost / Day ($)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={data.cost_by_day}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip formatter={(v) => `$${Number(v).toFixed(4)}`} />
              <Area type="monotone" dataKey="cost" stroke="#10b981" fill="#10b98140" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{
        display: "flex", gap: 24, marginBottom: 24, padding: "16px 20px",
        background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0",
        flexWrap: "wrap", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h3 style={{ marginBottom: 0, whiteSpace: "nowrap" }}>By Mode</h3>
          {["learn", "practice", "mock_test"].map((mode) => (
            <div key={mode} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: MODE_COLORS[mode] }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>
                {mode === "mock_test" ? "Mock Test" : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </span>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>{modeMap[mode] ?? 0}</span>
            </div>
          ))}
        </div>
        <div style={{ width: 1, height: 24, background: "#e2e8f0" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h3 style={{ marginBottom: 0, whiteSpace: "nowrap" }}>By Subject</h3>
          {data.by_subject.map((s) => (
            <div key={s.subject} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: SUBJECT_COLORS[s.subject] ?? "#94a3b8" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>
                {s.subject.charAt(0).toUpperCase() + s.subject.slice(1)}
              </span>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>{s.count}</span>
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
