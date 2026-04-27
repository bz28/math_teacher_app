import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from "recharts";
import { api, type LLMCallsData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import StatCard from "../components/StatCard";
import { Pagination } from "../components/Pagination";
import { useScope } from "../lib/scope";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

type Tab = "all" | "failures";
const PAGE_SIZE = 25;

export default function LLMCalls() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { apiSchoolFilter } = useScope();
  const schoolFilter = apiSchoolFilter() ?? "";
  const [data, setData] = useState<LLMCallsData | null>(null);
  const [hours, setHours] = useState("24");
  const [fnFilter, setFnFilter] = useState("");
  const [userFilter, setUserFilter] = useState(searchParams.get("user") ?? "");
  const submissionFilter = searchParams.get("submission") ?? "";
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
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.llmCalls({
      hours,
      function: fnFilter,
      user_id: userFilter,
      submission_id: submissionFilter,
      school_id: schoolFilter,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    }).then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, [hours, fnFilter, userFilter, submissionFilter, schoolFilter, offset]);

  // Reset offset whenever any non-pagination filter changes so a deep
  // link (?submission=…, ?user=…) or a scope flip never lands past the
  // end of the new result set. We do this in an effect rather than
  // per-handler because submissionFilter/schoolFilter/tab are URL-
  // driven (no handler to hook), and keeping every reset path in one
  // place stops the two from drifting.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset(0);
  }, [schoolFilter, userFilter, submissionFilter, fnFilter, hours]);

  // Local-state handlers — offset reset is handled by the effect
  // above, so we don't duplicate it here.
  const handleHoursChange = (v: string) => setHours(v);
  const handleUserFilter = (v: string) => setUserFilter(v);
  const handleFnFilter = (v: string) => setFnFilter(fnFilter === v ? "" : v);
  const clearSubmissionFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("submission");
    setSearchParams(next);
  };
  const handleSubmissionChipClick = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("submission", id);
    setSearchParams(next);
  };

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
                                to={`/admin/submissions/${c.submission_id}/trace`}
                                style={{ fontSize: 13, fontWeight: 600 }}
                              >
                                Open flight recorder for this submission →
                              </Link>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {callsToShow.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "#94a3b8", padding: 24 }}>
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

function shortModel(model: string): string {
  if (model.includes("sonnet")) return "Sonnet 4";
  if (model.includes("haiku")) return "Haiku 4.5";
  if (model.includes("opus")) return "Opus 4";
  // Fallback: strip date suffix and vendor prefix
  return model.replace(/-\d{8}$/, "").replace(/^claude-/, "");
}


// Render the metadata blob plus the promoted school_id / submission_id
// columns as a compact chip grid. Clicking the submission_id chip
// deep-links into the per-submission flight-recorder filter (sets
// ?submission=<id> on the URL); other chips are read-only labels.
function MetadataChips({
  metadata,
  schoolId,
  submissionId,
  onSubmissionClick,
}: {
  metadata: Record<string, unknown> | null;
  schoolId: string | null;
  submissionId: string | null;
  onSubmissionClick: (id: string) => void;
}) {
  // Deduplicate metadata keys against the promoted columns we render
  // explicitly. Some callers also stamp submission_id inside metadata
  // for redundancy; the indexed column is the source of truth.
  const skipKeys = new Set(["submission_id", "school_id"]);
  const entries = metadata
    ? Object.entries(metadata).filter(([k]) => !skipKeys.has(k))
    : [];

  if (!schoolId && !submissionId && entries.length === 0) {
    return <span className="metadata-empty">(none)</span>;
  }

  return (
    <div className="metadata-chips">
      {schoolId ? (
        <Chip label="school" value={shortId(schoolId)} title={schoolId} />
      ) : (
        // No school = "internal" bucket. Render with a different
        // pill shape (no label segment, distinct color) so it
        // can't be visually confused with a normal school chip
        // when scanning a column of expanded rows.
        <span
          className="metadata-chip metadata-chip-internal"
          title="school_id IS NULL — founder, test, or non-school user"
        >
          🏷️ internal
        </span>
      )}
      {submissionId && (
        <Chip
          label="submission"
          value={shortId(submissionId)}
          title={`Click to filter to this submission's calls\n${submissionId}`}
          onClick={() => onSubmissionClick(submissionId)}
        />
      )}
      {entries.map(([k, v]) => (
        <Chip key={k} label={k} value={renderChipValue(v)} />
      ))}
    </div>
  );
}

function Chip({
  label,
  value,
  title,
  onClick,
}: {
  label: string;
  value: string;
  title?: string;
  onClick?: () => void;
}) {
  // 30-char visual cap with ellipsis. Same threshold as the JS
  // truncation so the CSS max-width doesn't double-clip a value
  // that the JS already shortened.
  const truncated = value.length > 30 ? `${value.slice(0, 29)}…` : value;
  const className = `metadata-chip${onClick ? " metadata-chip-clickable" : ""}`;
  const fullTitle = title ?? value;
  return (
    <span
      className={className}
      title={fullTitle}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <span className="metadata-chip-label">{label}</span>
      <span className="metadata-chip-value">{truncated}</span>
    </span>
  );
}

function shortId(id: string): string {
  // First segment of a UUID (before the first hyphen) — unique enough
  // to scan visually while keeping chips compact.
  const idx = id.indexOf("-");
  return idx > 0 ? id.slice(0, idx) : id.slice(0, 8);
}

function renderChipValue(v: unknown): string {
  // Stringify nested objects/arrays as JSON so the chip never shows
  // "[object Object]" for a structured metadata value (e.g. a future
  // caller stamping {tool_calls: {...}}). Primitives go through
  // String() unchanged.
  if (v === null || v === undefined) return String(v);
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "[unserializable]";
    }
  }
  return String(v);
}

