import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { api, type LLMCallsData } from "../lib/api";
import StatCard from "../components/StatCard";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

export default function LLMCalls() {
  const [data, setData] = useState<LLMCallsData | null>(null);
  const [days, setDays] = useState("7");
  const [fnFilter, setFnFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    api.llmCalls({ days, function: fnFilter, user_id: userFilter }).then(setData);
  }, [days, fnFilter, userFilter]);

  if (!data) return <p>Loading...</p>;

  const totalCalls = data.by_function.reduce((s, r) => s + r.count, 0);
  const totalCost = data.by_function.reduce((s, r) => s + r.total_cost, 0);

  return (
    <div>
      <h1>LLM Calls</h1>

      <div className="filters" style={{ display: "flex", gap: 12 }}>
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
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
        <StatCard label="Total Calls" value={totalCalls} />
        <StatCard label="Total Cost" value={`$${totalCost.toFixed(4)}`} />
        <StatCard label="Failures" value={data.failure_count} sub={`${data.failure_rate}% failure rate`} />
        <StatCard label="Models" value={data.by_model.length} />
      </div>

      <div className="chart-row">
        <div className="chart-card">
          <h3>Calls / Day</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.by_day}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Cost by Model</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={data.by_model}
                dataKey="total_cost"
                nameKey="model"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
              >
                {data.by_model.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip formatter={(v) => `$${Number(v).toFixed(4)}`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="table-card">
        <h3>By Function</h3>
        <table>
          <thead>
            <tr>
              <th>Function</th>
              <th>Calls</th>
              <th>Cost</th>
              <th>Avg Latency</th>
              <th>Avg In Tokens</th>
              <th>Avg Out Tokens</th>
            </tr>
          </thead>
          <tbody>
            {data.by_function.map((r) => (
              <tr
                key={r.function}
                className="clickable"
                onClick={() => setFnFilter(fnFilter === r.function ? "" : r.function)}
              >
                <td>{r.function}</td>
                <td>{r.count}</td>
                <td>${r.total_cost.toFixed(4)}</td>
                <td>{r.avg_latency_ms.toFixed(0)}ms</td>
                <td>{r.avg_input_tokens}</td>
                <td>{r.avg_output_tokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.failure_count > 0 && (
        <>
          <div className="chart-row">
            <div className="chart-card">
              <h3>Failures by Function</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.failures_by_function}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="function" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="table-card">
            <h3>Recent Failures</h3>
            <table>
              <thead>
                <tr>
                  <th>Function</th>
                  <th>Model</th>
                  <th>User</th>
                  <th>Retries</th>
                  <th>Error</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_failures.map((f) => (
                  <tr key={f.id}>
                    <td>{f.function}</td>
                    <td>{f.model}</td>
                    <td>{f.user_name || "-"}</td>
                    <td>{f.retry_count}</td>
                    <td style={{ maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.output_text || "(no error text)"}
                    </td>
                    <td>{new Date(f.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="table-card">
        <h3>Recent Calls {fnFilter && <span className="filter-badge">{fnFilter} <button onClick={() => setFnFilter("")}>x</button></span>}</h3>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Function</th>
              <th>Model</th>
              <th>User</th>
              <th>Tokens (in/out)</th>
              <th>Latency</th>
              <th>Cost</th>
              <th>OK</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {data.calls.map((c) => (
              <>
                <tr
                  key={c.id}
                  className="clickable"
                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                >
                  <td>{expandedId === c.id ? "\u25BC" : "\u25B6"}</td>
                  <td>{c.function}</td>
                  <td>{c.model}</td>
                  <td>{c.user_name || "-"}</td>
                  <td>{c.input_tokens}/{c.output_tokens}</td>
                  <td>{c.latency_ms.toFixed(0)}ms</td>
                  <td>${c.cost_usd.toFixed(6)}</td>
                  <td>{c.success ? "Y" : "N"}</td>
                  <td>{new Date(c.created_at).toLocaleString()}</td>
                </tr>
                {expandedId === c.id && (
                  <tr key={`${c.id}-detail`}>
                    <td colSpan={9} style={{ padding: 0 }}>
                      <div className="call-detail">
                        <div className="call-detail-section">
                          <strong>Input</strong>
                          <pre>{c.input_text || "(not captured)"}</pre>
                        </div>
                        <div className="call-detail-section">
                          <strong>Output</strong>
                          <pre>{c.output_text || "(not captured)"}</pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
