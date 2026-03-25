import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell,
} from "recharts";
import { api, type SessionsData } from "../lib/api";
import StatCard from "../components/StatCard";

const MODE_COLORS: Record<string, string> = {
  learn: "#6366f1",
  practice: "#10b981",
  mock_test: "#f59e0b",
};

export default function Sessions() {
  const [data, setData] = useState<SessionsData | null>(null);
  const [hours, setHours] = useState("168");
  const [userFilter, setUserFilter] = useState("");

  useEffect(() => {
    api.sessions({ hours, user_id: userFilter }).then(setData);
  }, [hours, userFilter]);

  if (!data) return <p>Loading...</p>;

  const modeMap = Object.fromEntries(data.by_mode.map((m) => [m.mode, m.count]));

  return (
    <div>
      <h1>Sessions</h1>

      <div className="filters" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <select value={hours} onChange={(e) => setHours(e.target.value)}>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
          <option value="87600">All time</option>
        </select>
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
          <option value="">All Users</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>{u.email}</option>
          ))}
        </select>
        {userFilter && (
          <button className="filter-badge" onClick={() => setUserFilter("")} style={{ cursor: "pointer", border: "none" }}>
            Filtered by user ✕
          </button>
        )}
      </div>

      <div className="stat-grid">
        <StatCard label="Total Sessions" value={data.total_count} />
        <StatCard label="Learn" value={modeMap["learn"] ?? 0} />
        <StatCard label="Practice" value={modeMap["practice"] ?? 0} />
        <StatCard label="Mock Test" value={modeMap["mock_test"] ?? 0} />
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
          <h3>By Mode</h3>
          <ResponsiveContainer width="100%" height={250}>
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
      </div>
    </div>
  );
}
