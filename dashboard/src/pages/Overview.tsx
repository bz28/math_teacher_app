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
        <StatCard label="Completion Rate (7d)" value={`${data.completion_rate_7d}%`} />
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

      <div className="table-card">
        <h3>Recent Sessions</h3>
        <table>
          <thead>
            <tr>
              <th>Problem</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {data.recent_sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.problem}</td>
                <td>{s.mode}</td>
                <td><span className={`badge badge-${s.status}`}>{s.status}</span></td>
                <td>{s.current_step}/{s.total_steps}</td>
                <td>{new Date(s.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
