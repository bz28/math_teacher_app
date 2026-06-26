import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from "recharts";
import { api, type LLMCallsData, type SchoolListItem } from "../lib/api";
import { formatRelativeDate, shortModel } from "../lib/format";
import StatCard from "../components/StatCard";
import MetadataChips from "../components/MetadataChips";
import { Pagination } from "../components/Pagination";

const COLORS = ["#14130f", "#4a6b3a", "#b8431a", "#3d5a78", "#a66b15", "#6b21a8"];

type Tab = "all" | "failures";
const PAGE_SIZE = 25;

export default function LLMCalls() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tracePathFor = (submissionId: string) =>
    `/submissions/${submissionId}/trace`;
  const [data, setData] = useState<LLMCallsData | null>(null);
  // `hours` is URL-driven so deep links from SchoolDetail / TeacherDetail
  // ("View calls (30d)" → ?hours=720) and from Overview ("View failures"
  // → ?hours=168) land on the time window they advertised. Initial state
  // reads searchParams; subsequent edits sync back via handleHoursChange.
  const [hours, setHours] = useState(searchParams.get("hours") ?? "24");
  const [fnFilter, setFnFilter] = useState("");
  const [userFilter, setUserFilter] = useState(searchParams.get("user") ?? "");
  const submissionFilter = searchParams.get("submission") ?? "";
  // school filter is URL-driven so deep links from the School detail
  // page (?school=:id&tab=failures&hours=168) land on a filtered view.
  const schoolFilter = searchParams.get("school") ?? "";
  // Tab is URL-driven so deep links like ?tab=failures from the
  // Overview "View failures →" link land on the right view.
  const tab: Tab = searchParams.get("tab") === "failures" ? "failures" : "all";
  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (next === "failures") params.set("tab", "failures");
    else params.delete("tab");
    setSearchParams(params);
  };
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [debugState, setDebugState] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  // Schools list used to populate the School dropdown. Loaded once
  // on mount — cheap query and rarely changes. If it fails the
  // dropdown just hides; the URL filter still works.
  const [schools, setSchools] = useState<SchoolListItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    api.schools()
      .then((d) => { if (!cancelled) setSchools(d.schools); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.llmCalls({
      hours,
      function: fnFilter,
      user_id: userFilter,
      submission_id: submissionFilter,
      school_id: schoolFilter,
      // Failures tab filters server-side so total_count + pagination
      // reflect only failed calls (not just failures on the current page).
      ...(tab === "failures" ? { success: "false" } : {}),
      limit: String(PAGE_SIZE),
      offset: String(offset),
    }).then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, [hours, fnFilter, userFilter, submissionFilter, schoolFilter, tab, offset]);

  // Reset offset whenever any non-pagination filter changes so a deep
  // link (?submission=…, ?user=…) or a scope flip never lands past the
  // end of the new result set. We do this in an effect rather than
  // per-handler because submissionFilter/schoolFilter/tab are URL-
  // driven (no handler to hook), and keeping every reset path in one
  // place stops the two from drifting.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset(0);
  }, [userFilter, submissionFilter, schoolFilter, fnFilter, hours, tab]);

  // Local-state handlers — offset reset is handled by the effect
  // above, so we don't duplicate it here. handleHoursChange also
  // mirrors the new value back into the URL so the user can copy
  // a link that lands on the same window they're currently viewing.
  const handleHoursChange = (v: string) => {
    setHours(v);
    const next = new URLSearchParams(searchParams);
    if (v === "24") next.delete("hours");
    else next.set("hours", v);
    setSearchParams(next);
  };
  const handleUserFilter = (v: string) => setUserFilter(v);
  const handleFnFilter = (v: string) => setFnFilter(fnFilter === v ? "" : v);
  const clearSubmissionFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("submission");
    setSearchParams(next);
  };
  const clearSchoolFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("school");
    setSearchParams(next);
  };
  const handleSchoolFilter = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("school", id);
    else next.delete("school");
    setSearchParams(next);
  };
  const handleSubmissionChipClick = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("submission", id);
    setSearchParams(next);
  };

  const handleDebug = async (callId: string) => {
    if (!window.confirm("Dispatch a debugging agent for this call? It runs on GitHub and posts its findings as an issue.")) {
      return;
    }
    setDebugState((s) => ({ ...s, [callId]: "sending" }));
    try {
      await api.debugLLMCall(callId);
      setDebugState((s) => ({ ...s, [callId]: "sent" }));
    } catch {
      setDebugState((s) => ({ ...s, [callId]: "error" }));
    }
  };

  if (!data) return <p className="loading">Loading…</p>;

  const totalCalls = data.by_function.reduce((s, r) => s + r.count, 0);
  const totalCost = data.by_function.reduce((s, r) => s + r.total_cost, 0);

  // Failures are filtered server-side (success=false) so total_count and
  // pagination stay correct; the list here is already scoped to the tab.
  const callsToShow = data.calls;

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">Diagnostic</span>
        <h1>LLM calls</h1>
        <p>Every model call the pipeline made — searchable by user, submission, or function.</p>
      </div>

      <div className="filters" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <select value={hours} onChange={(e) => handleHoursChange(e.target.value)}>
          <option value="1">Last hour</option>
          <option value="6">Last 6 hours</option>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
        </select>
        <select value={userFilter} onChange={(e) => handleUserFilter(e.target.value)}>
          <option value="">All users</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>{u.email}</option>
          ))}
        </select>
        {schools.length > 0 && (
          <select value={schoolFilter} onChange={(e) => handleSchoolFilter(e.target.value)}>
            <option value="">All schools</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        {userFilter && (
          <button className="filter-badge" onClick={() => handleUserFilter("")} style={{ cursor: "pointer", border: "none" }}>
            Filtered by user ✕
          </button>
        )}
        {schoolFilter && (
          <button
            className="filter-badge"
            onClick={clearSchoolFilter}
            style={{ cursor: "pointer", border: "none" }}
            title={schoolFilter}
          >
            School: {schoolLabel(schoolFilter, schools)} ✕
          </button>
        )}
        {submissionFilter && (
          <button
            className="filter-badge"
            onClick={clearSubmissionFilter}
            style={{ cursor: "pointer", border: "none" }}
            title={submissionFilter}
          >
            Submission: {submissionFilter.slice(0, 8)}… ✕
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
          <h3>Calls / day</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.by_day}>
              <CartesianGrid strokeDasharray="2 4" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#14130f" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Cost by model</h3>
          <ResponsiveContainer width="100%" height={240}>
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
          <h3>Avg latency / day (ms)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.by_day}>
              <CartesianGrid strokeDasharray="2 4" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip formatter={(v) => `${Number(v).toFixed(0)}ms`} />
              <Line type="monotone" dataKey="avg_latency" stroke="#b8431a" strokeWidth={1.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {data.recent_failures.length > 0 && (
        <div className="table-card" style={{ borderTop: "1px solid var(--danger)" }}>
          <h3 style={{ color: "var(--danger)" }}>Recent failures ({data.recent_failures.length})</h3>
          <div className="table-scroll">
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
                <tr key={f.id} style={{ background: "var(--danger-soft)" }}>
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
        </div>
      )}

      <div className="table-card">
        <h3>By Function</h3>
        <div className="table-scroll">
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
      </div>

      <div className="table-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ marginBottom: 0 }}>
            {tab === "all" ? "Recent Calls" : "Recent Failures"}
            {fnFilter && <span className="filter-badge">{fnFilter} <button onClick={() => handleFnFilter(fnFilter)}>x</button></span>}
          </h3>
          <div style={{ display: "flex", gap: 2, background: "var(--paper-2)", border: "1px solid var(--rule)", borderRadius: 4, padding: 2 }}>
            <button
              onClick={() => setTab("all")}
              style={{
                padding: "6px 14px", border: "none", borderRadius: 2, fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: tab === "all" ? "var(--surface)" : "transparent",
                color: tab === "all" ? "var(--ink)" : "var(--muted)",
              }}
            >
              All ({totalCalls})
            </button>
            <button
              onClick={() => setTab("failures")}
              style={{
                padding: "6px 14px", border: "none", borderRadius: 2, fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: tab === "failures" ? "var(--surface)" : "transparent",
                color: tab === "failures" ? "var(--danger)" : "var(--muted)",
              }}
            >
              Failures ({data.failure_count})
            </button>
          </div>
        </div>
        <div className="table-scroll">
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
              <Fragment key={c.id}>
                <tr
                  className="clickable"
                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  style={!c.success ? { background: "var(--danger-soft)" } : undefined}
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
                  <tr>
                    <td colSpan={9} style={{ padding: 0 }}>
                      <div className="call-detail">
                        <div className="call-detail-row">
                          <div className="call-detail-section">
                            <strong>Input</strong>
                            <pre>{c.input_text || "(not captured)"}</pre>
                          </div>
                          <div className="call-detail-section">
                            <strong>{c.success ? "Output" : "Error"}</strong>
                            <pre>{c.output_text || "(not captured)"}</pre>
                          </div>
                        </div>
                        <div className="call-detail-metadata">
                          <strong>Metadata</strong>
                          <MetadataChips
                            metadata={c.metadata}
                            schoolId={c.school_id}
                            submissionId={c.submission_id}
                            onSubmissionClick={handleSubmissionChipClick}
                          />
                          {c.submission_id && (
                            <div style={{ marginTop: 8 }}>
                              <Link
                                to={tracePathFor(c.submission_id)}
                                style={{ fontSize: 13, fontWeight: 600 }}
                              >
                                Open flight recorder for this submission →
                              </Link>
                            </div>
                          )}
                          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
                            <button
                              onClick={() => handleDebug(c.id)}
                              disabled={debugState[c.id] === "sending"}
                              style={{ fontSize: 13, fontWeight: 600, padding: "4px 10px", cursor: "pointer" }}
                            >
                              🔍 Debug with agent
                            </button>
                            {(debugState[c.id] === "sent" || Boolean(c.metadata?.debug_dispatched_at)) && (
                              <a
                                href={`https://github.com/${data.repo}/issues?q=${encodeURIComponent(`is:issue label:llm-debug ${c.id}`)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 13, fontWeight: 600 }}
                                title="Open the debug agent's findings for this call on GitHub"
                              >
                                🔗 Debug results
                              </a>
                            )}
                            {debugState[c.id] === "sending" && <span style={{ fontSize: 13, color: "var(--muted-2)" }}>Dispatching…</span>}
                            {debugState[c.id] === "sent" && <span style={{ fontSize: 13, color: "var(--ok, green)" }}>Dispatched — results appear under 🔗 once the agent finishes.</span>}
                            {debugState[c.id] === "error" && <span style={{ fontSize: 13, color: "var(--danger, crimson)" }}>Dispatch failed (token configured?).</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {callsToShow.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted-2)", padding: 24 }}>
                {tab === "failures" ? "No failures in this period" : "No calls found"}
              </td></tr>
            )}
          </tbody>
        </table>
        </div>
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

function schoolLabel(id: string, schools: SchoolListItem[]): string {
  const match = schools.find((s) => s.id === id);
  return match ? match.name : `${id.slice(0, 8)}…`;
}

