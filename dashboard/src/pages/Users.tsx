import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { api, type UsersData } from "../lib/api";
import StatCard from "../components/StatCard";

type SortKey = "total_cost" | "session_count" | "last_active" | "name";

export default function Users() {
  const [data, setData] = useState<UsersData | null>(null);
  const [hours, setHours] = useState("720");
  const [sortBy, setSortBy] = useState<SortKey>("total_cost");

  useEffect(() => {
    api.users({ hours, sort_by: sortBy }).then(setData);
  }, [hours, sortBy]);

  if (!data) return <p>Loading...</p>;

  const topSpender = data.users.length > 0 ? data.users[0] : null;

  return (
    <div>
      <h1>Users</h1>

      <div className="filters">
        <select value={hours} onChange={(e) => setHours(e.target.value)}>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
          <option value="2160">Last 90 days</option>
        </select>
      </div>

      <div className="stat-grid">
        <StatCard label="Total Users" value={data.total_users} />
        <StatCard label="Active (7d)" value={data.active_7d} />
        <StatCard label="Total Spend" value={`$${data.total_spend.toFixed(2)}`} />
        <StatCard
          label="Top Spender"
          value={topSpender ? `$${topSpender.total_cost.toFixed(2)}` : "-"}
          sub={topSpender?.name || topSpender?.email || "-"}
        />
      </div>

      <div className="chart-row">
        <div className="chart-card" style={{ flex: 1 }}>
          <h3>Registrations / Day</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.registrations_by_day}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="table-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3>All Users</h3>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} style={{ fontSize: 13 }}>
            <option value="total_cost">Sort by Cost</option>
            <option value="session_count">Sort by Sessions</option>
            <option value="last_active">Sort by Last Active</option>
            <option value="name">Sort by Name</option>
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Grade</th>
              <th>Sessions</th>
              <th>LLM Calls</th>
              <th>Total Cost</th>
              <th>Avg $/Session</th>
              <th>Last Active</th>
              <th>Registered</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td>{u.name || "-"}</td>
                <td>{u.email}</td>
                <td>{u.grade_level}</td>
                <td>{u.session_count}</td>
                <td>{u.llm_call_count}</td>
                <td style={{ fontWeight: u.total_cost > 0 ? 600 : 400 }}>
                  ${u.total_cost.toFixed(4)}
                </td>
                <td>${u.avg_cost_per_session.toFixed(4)}</td>
                <td>{u.last_active ? new Date(u.last_active).toLocaleString() : "-"}</td>
                <td>{new Date(u.registered).toLocaleDateString()}</td>
              </tr>
            ))}
            {data.users.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "#999" }}>No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
