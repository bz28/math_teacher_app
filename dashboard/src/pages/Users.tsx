import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { api, type UsersData } from "../lib/api";
import StatCard from "../components/StatCard";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444"];

export default function Users() {
  const [data, setData] = useState<UsersData | null>(null);
  const [days, setDays] = useState("30");

  useEffect(() => {
    api.users({ days }).then(setData);
  }, [days]);

  if (!data) return <p>Loading...</p>;

  const distData = Object.entries(data.session_distribution).map(([k, v]) => ({
    name: `${k} sessions`,
    value: v,
  }));

  return (
    <div>
      <h1>Users</h1>

      <div className="filters">
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      <div className="stat-grid">
        <StatCard label="Total Users" value={data.total_users} />
        <StatCard label="Active (7d)" value={data.active_7d} />
      </div>

      <div className="chart-row">
        <div className="chart-card">
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

        <div className="chart-card">
          <h3>Session Distribution</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={distData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label
              >
                {distData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="table-card">
        <h3>Most Active Users</h3>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Grade</th>
              <th>Sessions</th>
              <th>Last Active</th>
            </tr>
          </thead>
          <tbody>
            {data.top_users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.grade_level}</td>
                <td>{u.session_count}</td>
                <td>{u.last_active ? new Date(u.last_active).toLocaleString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
