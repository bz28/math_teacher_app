import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import { api, type OverviewData } from "../lib/api";
import StatCard from "../components/StatCard";

const MODE_COLORS: Record<string, string> = {
  learn: "#6366f1",
  practice: "#10b981",
  mock_test: "#f59e0b",
};

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [hours, setHours] = useState("24");
  const [grade, setGrade] = useState("");

  useEffect(() => {
    api.overview({ hours, grade }).then(setData);
  }, [hours, grade]);

  if (!data) return <p>Loading...</p>;

  const modeMap = Object.fromEntries(data.by_mode.map((m) => [m.mode, m.count]));

  return (
    <div>
      <h1>Overview</h1>

      <div className="filters" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <select value={hours} onChange={(e) => setHours(e.target.value)}>
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
        <StatCard label="LLM Calls" value={data.total_calls} />
        <StatCard
          label="Error Rate"
          value={`${data.error_rate}%`}
          sub={`${data.failed_calls} failed`}
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

      <div className="chart-row">
        <div className="chart-card">
          <h3>Mode Usage</h3>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <StatCard label="Learn" value={modeMap["learn"] ?? 0} />
            <StatCard label="Practice" value={modeMap["practice"] ?? 0} />
            <StatCard label="Mock Test" value={modeMap["mock_test"] ?? 0} />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.by_mode}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="mode" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count">
                {data.by_mode.map((entry, i) => (
                  <Cell key={i} fill={MODE_COLORS[entry.mode] ?? "#6366f1"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {data.top_spenders.length > 0 && (
          <div className="chart-card">
            <h3>Top Spenders</h3>
            <table>
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
    </div>
  );
}
