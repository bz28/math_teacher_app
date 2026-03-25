import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { api, type OverviewData } from "../lib/api";
import StatCard from "../components/StatCard";

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [hours, setHours] = useState("24");

  useEffect(() => {
    api.overview({ hours }).then(setData);
  }, [hours]);

  if (!data) return <p>Loading...</p>;

  return (
    <div>
      <h1>Overview</h1>

      <div className="filters">
        <select value={hours} onChange={(e) => setHours(e.target.value)}>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
          <option value="87600">All time</option>
        </select>
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

      {data.top_spenders.length > 0 && (
        <div className="table-card">
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
  );
}
