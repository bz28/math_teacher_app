import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { api, type OverviewData } from "../lib/api";
import StatCard from "../components/StatCard";

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);

  useEffect(() => {
    api.overview().then(setData);
  }, []);

  if (!data) return <p>Loading...</p>;

  const sessionsDelta = data.sessions_today - data.sessions_yesterday;
  const costDelta = data.cost_today - data.cost_yesterday;

  return (
    <div>
      <h1>Overview</h1>

      <div className="stat-grid">
        <StatCard
          label="Sessions Today"
          value={data.sessions_today}
          sub={`${sessionsDelta >= 0 ? "+" : ""}${sessionsDelta} vs yesterday`}
        />
        <StatCard
          label="Cost Today"
          value={`$${data.cost_today.toFixed(4)}`}
          sub={`${costDelta >= 0 ? "+" : ""}$${costDelta.toFixed(4)} vs yesterday`}
        />
        <StatCard label="Active Users (7d)" value={data.active_users_7d} />
        <StatCard label="Cost (7d)" value={`$${data.cost_7d.toFixed(2)}`} />
        <StatCard
          label="Error Rate (24h)"
          value={`${data.error_rate_24h}%`}
          sub={`${data.failed_calls_24h} failed calls`}
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
          <h3>Top Spenders (7d)</h3>
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
