import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from "recharts";
import { api, type SessionsData } from "../lib/api";
import StatCard from "../components/StatCard";

export default function Sessions() {
  const [data, setData] = useState<SessionsData | null>(null);
  const [days, setDays] = useState("30");

  useEffect(() => {
    api.sessions({ days }).then(setData);
  }, [days]);

  if (!data) return <p>Loading...</p>;

  return (
    <div>
      <h1>Sessions</h1>

      <div className="filters">
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      <div className="stat-grid">
        <StatCard label="Total Sessions" value={data.total_count} />
        <StatCard label="Avg Steps" value={data.averages.avg_steps} />
        <StatCard label="Avg Progress" value={data.averages.avg_progress} />
        <StatCard label="Abandoned" value={data.abandoned.length} />
      </div>

      <div className="chart-row">
        <div className="chart-card">
          <h3>Completion Rate / Day</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data.completion_by_day}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Line type="monotone" dataKey="rate" stroke="#6366f1" strokeWidth={2} />
            </LineChart>
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
              <Bar dataKey="count" fill="#6366f1" name="Total" />
              <Bar dataKey="completed" fill="#10b981" name="Completed" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="table-card">
        <h3>Top Problems</h3>
        <table>
          <thead>
            <tr>
              <th>Problem</th>
              <th>Count</th>
              <th>Completed</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {data.top_problems.map((r, i) => (
              <tr key={i}>
                <td>{r.problem}</td>
                <td>{r.count}</td>
                <td>{r.completed}</td>
                <td>{r.rate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-card">
        <h3>Recent Sessions</h3>
        <table>
          <thead>
            <tr>
              <th>Problem</th>
              <th>Mode</th>
              <th>Type</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.problem}</td>
                <td>{s.mode}</td>
                <td>{s.problem_type}</td>
                <td><span className={`badge badge-${s.status}`}>{s.status}</span></td>
                <td>{s.current_step}/{s.total_steps}</td>
                <td>{new Date(s.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.abandoned.length > 0 && (
        <div className="table-card">
          <h3>Abandoned Sessions</h3>
          <table>
            <thead>
              <tr>
                <th>Problem</th>
                <th>Mode</th>
                <th>Progress</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.abandoned.map((s) => (
                <tr key={s.id}>
                  <td>{s.problem}</td>
                  <td>{s.mode}</td>
                  <td>{s.current_step}/{s.total_steps}</td>
                  <td>{new Date(s.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
