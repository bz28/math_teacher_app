import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from "recharts";
import { api, type LLMCallsData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import StatCard from "../components/StatCard";
import { Pagination } from "../components/Pagination";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

type Tab = "all" | "failures";
const PAGE_SIZE = 25;

export default function LLMCalls() {
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<LLMCallsData | null>(null);
  const [hours, setHours] = useState("24");
  const [fnFilter, setFnFilter] = useState("");
  const [userFilter, setUserFilter] = useState(searchParams.get("user") ?? "");
  const [tab, setTab] = useState<Tab>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    api.llmCalls({
      hours,
      function: fnFilter,
      user_id: userFilter,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    }).then(setData);
  }, [hours, fnFilter, userFilter, offset]);

  // Reset to first page when filters change
  const handleHoursChange = (v: string) => { setHours(v); setOffset(0); };
  const handleUserFilter = (v: string) => { setUserFilter(v); setOffset(0); };
  const handleFnFilter = (v: string) => { setFnFilter(fnFilter === v ? "" : v); setOffset(0); };

  if (!data) return <p>Loading...</p>;

  const totalCalls = data.by_function.reduce((s, r) => s + r.count, 0);
  const totalCost = data.by_function.reduce((s, r) => s + r.total_cost, 0);

  const callsToShow = tab === "failures"
    ? data.calls.filter((c) => !c.success)
    : data.calls;

  return (
    <div>
      <h1>LLM Calls</h1>

      <div className="filters" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <select value={hours} onChange={(e) => handleHoursChange(e.target.value)}>
          <option value="1">Last hour</option>
          <option value="6">Last 6 hours</option>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
        </select>
        <select value={userFilter} onChange={(e) => handleUserFilter(e.target.value)}>
          <option value="">All Users</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>{u.email}</option>
          ))}
        </select>
        {userFilter && (
          <button className="filter-badge" onClick={() => handleUserFilter("")} style={{ cursor: "pointer", border: "none" }}>
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

      <div className="chart-row">
        <div className="chart-card" style={{ gridColumn: "1 / -1" }}>
          <h3>Avg Latency / Day (ms)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.by_day}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip formatter={(v) => `${Number(v).toFixed(0)}ms`} />
              <Line type="monotone" dataKey="avg_latency" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {data.recent_failures.length > 0 && (
        <div className="table-card" style={{ borderLeft: "3px solid #ef4444" }}>
          <h3 style={{ color: "#ef4444" }}>Recent Failures ({data.recent_failures.length})</h3>
          <table>
            <colgroup>
              <col style={{ width: "20%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "30%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Function</th>
                <th>Model</th>
                <th>User</th>
                <th>Error</th>
                <th>Retries</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_failures.map((f) => (
                <tr key={f.id} style={{ background: "#fef2f2" }}>
                  <td>{f.function}</td>
                  <td>{f.model}</td>
                  <td>{f.user_name || "-"}</td>
                  <td title={f.output_text || undefined} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.output_text
                      ? (f.output_text.length > 80 ? f.output_text.slice(0, 80) + "..." : f.output_text)
                      : "-"}
                  </td>
                  <td>{f.retry_count > 0 ? f.retry_count : "-"}</td>
                  <td title={new Date(f.created_at).toLocaleString()}>{formatRelativeDate(f.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="table-card">
        <h3>By Function</h3>
        <table>
          <colgroup>
            <col style={{ width: "28%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "15%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Function</th>
              <th>Calls</th>
              <th>Cost</th>
              <th>Avg Latency</th>
              <th>Avg In</th>
              <th>Avg Out</th>
            </tr>
          </thead>
          <tbody>
            {data.by_function.map((r) => (
              <tr
                key={r.function}
                className="clickable"
                onClick={() => handleFnFilter(r.function)}
                style={fnFilter === r.function ? { background: "#ede9fe" } : undefined}
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

      <div className="table-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ marginBottom: 0 }}>
            {tab === "all" ? "Recent Calls" : "Recent Failures"}
            {fnFilter && <span className="filter-badge">{fnFilter} <button onClick={() => handleFnFilter(fnFilter)}>x</button></span>}
          </h3>
          <div style={{ display: "flex", gap: 4, background: "#f1f5f9", borderRadius: 6, padding: 2 }}>
            <button
              onClick={() => setTab("all")}
              style={{
                padding: "6px 14px", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: tab === "all" ? "#fff" : "transparent",
                color: tab === "all" ? "#1e293b" : "#94a3b8",
                boxShadow: tab === "all" ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              }}
            >
              All ({totalCalls})
            </button>
            <button
              onClick={() => setTab("failures")}
              style={{
                padding: "6px 14px", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: tab === "failures" ? "#fff" : "transparent",
                color: tab === "failures" ? "#ef4444" : "#94a3b8",
                boxShadow: tab === "failures" ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              }}
            >
              Failures ({data.failure_count})
            </button>
          </div>
        </div>
        <table>
          <colgroup>
            <col style={{ width: "3%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "16%" }} />
          </colgroup>
          <thead>
            <tr>
              <th></th>
              <th>Function</th>
              <th>Model</th>
              <th>User</th>
              <th>Tokens</th>
              <th>Latency</th>
              <th>Cost</th>
              <th>Retry</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {callsToShow.map((c) => (
              <>
                <tr
                  key={c.id}
                  className="clickable"
                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  style={!c.success ? { background: "#fef2f2" } : undefined}
                >
                  <td>{expandedId === c.id ? "\u25BC" : "\u25B6"}</td>
                  <td>{c.function}</td>
                  <td title={c.model}>{shortModel(c.model)}</td>
                  <td>{c.user_name || "-"}</td>
                  <td>{c.input_tokens}/{c.output_tokens}</td>
                  <td>{c.latency_ms.toFixed(0)}ms</td>
                  <td>${c.cost_usd.toFixed(4)}</td>
                  <td>{c.retry_count > 0 ? c.retry_count : "-"}</td>
                  <td title={new Date(c.created_at).toLocaleString()}>{formatRelativeDate(c.created_at)}</td>
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
                          <strong>{c.success ? "Output" : "Error"}</strong>
                          <pre>{c.output_text || "(not captured)"}</pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {callsToShow.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "#94a3b8", padding: 24 }}>
                {tab === "failures" ? "No failures in this period" : "No calls found"}
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination
          offset={offset}
          limit={PAGE_SIZE}
          total={data.total_count}
          onChange={setOffset}
        />
      </div>
    </div>
  );
}

function shortModel(model: string): string {
  if (model.includes("sonnet")) return "Sonnet 4";
  if (model.includes("haiku")) return "Haiku 4.5";
  if (model.includes("opus")) return "Opus 4";
  // Fallback: strip date suffix and vendor prefix
  return model.replace(/-\d{8}$/, "").replace(/^claude-/, "");
}

