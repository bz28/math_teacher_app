import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, LineChart, Line,
} from "recharts";
import { api, type LLMCallsData, type SchoolListItem } from "../lib/api";
import { formatRelativeDate, shortModel, shortId, fmtCost } from "../lib/format";
import { windowLabel } from "../lib/definitions";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import MetadataChips from "../components/MetadataChips";
import { Pagination, SearchInput } from "../components/Pagination";
import ErrorState from "../components/ErrorState";

const COLORS = ["#14130f", "#4a6b3a", "#b8431a", "#3d5a78", "#a66b15", "#6b21a8"];
const PAGE_SIZE = 25;

type CallRow = LLMCallsData["calls"][number];
type Status = "" | "ok" | "failed";

function fmtLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export default function LLMCalls() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tracePathFor = (submissionId: string) => `/submissions/${submissionId}/trace`;

  const [data, setData] = useState<LLMCallsData | null>(null);
  // Time window is URL-driven so deep links from Overview / SchoolDetail /
  // TeacherDetail ("View calls (30d)" → ?hours=720, failed calls → ?status=
  // failed) land on the window + scope they advertised.
  const [hours, setHours] = useState(searchParams.get("hours") ?? "24");
  const [userFilter, setUserFilter] = useState(searchParams.get("user") ?? "");
  const [fnFilter, setFnFilter] = useState("");
  const [search, setSearch] = useState("");
  // URL-driven scopes (deep-linkable): submission, session, school, status.
  const submissionFilter = searchParams.get("submission") ?? "";
  const sessionFilter = searchParams.get("session") ?? "";
  const schoolFilter = searchParams.get("school") ?? "";
  const status: Status = ((): Status => {
    const s = searchParams.get("status");
    return s === "ok" || s === "failed" ? s : "";
  })();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [debugState, setDebugState] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Schools list for the School dropdown. Loaded once — cheap and rarely
  // changes; if it fails the dropdown just hides and the URL filter still works.
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
      session_id: sessionFilter,
      school_id: schoolFilter,
      search,
      ...(status === "ok" ? { success: "true" } : status === "failed" ? { success: "false" } : {}),
      limit: String(PAGE_SIZE),
      offset: String(offset),
    })
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load LLM calls."); });
    return () => { cancelled = true; };
  }, [hours, fnFilter, userFilter, submissionFilter, sessionFilter, schoolFilter, status, search, offset, reloadKey]);

  // Reset pagination whenever any non-offset filter changes so a deep link or
  // scope flip never lands past the end of a smaller result set. One effect
  // (not per-handler) because several filters are URL-driven with no handler.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset(0);
  }, [hours, fnFilter, userFilter, submissionFilter, sessionFilter, schoolFilter, status, search]);

  const handleHoursChange = (v: string) => {
    setHours(v);
    const next = new URLSearchParams(searchParams);
    if (v === "24") next.delete("hours"); else next.set("hours", v);
    setSearchParams(next);
  };
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
  };

  const handleDebug = async (callId: string) => {
    if (!window.confirm("Dispatch a debugging agent for this call? It runs on GitHub and posts its findings as an issue.")) return;
    setDebugState((s) => ({ ...s, [callId]: "sending" }));
    try {
      await api.debugLLMCall(callId);
      setDebugState((s) => ({ ...s, [callId]: "sent" }));
    } catch {
      setDebugState((s) => ({ ...s, [callId]: "error" }));
    }
  };

  const columns: Column<CallRow>[] = useMemo(() => [
    {
      key: "created_at", header: "When", width: "16%",
      sortValue: (c) => new Date(c.created_at).getTime(),
      render: (c) => (
        <span title={new Date(c.created_at).toLocaleString()}>{formatRelativeDate(c.created_at)}</span>
      ),
    },
    {
      key: "user", header: "User", width: "22%",
      render: (c) => <span style={{ color: "var(--ink)" }}>{c.user_name || "—"}</span>,
    },
    {
      key: "function", header: "Function", width: "26%",
      render: (c) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink)", fontWeight: 500 }}>{c.function}</div>
          <div className="llm-ctx">
            {c.submission_id && <span className="llm-ctx-tag" title={`submission ${c.submission_id}`}>▤ {shortId(c.submission_id)}</span>}
            {c.session_id && <span className="llm-ctx-tag" title={`session ${c.session_id}`}>⧉ {shortId(c.session_id)}</span>}
          </div>
        </div>
      ),
    },
    {
      key: "status", header: "Status", width: "12%",
      sortValue: (c) => (c.success ? 1 : 0),
      render: (c) => <StatusPill tone={c.success ? "ok" : "danger"} label={c.success ? "OK" : "FAIL"} />,
    },
    {
      key: "cost", header: "Cost", numeric: true, width: "12%",
      sortValue: (c) => c.cost_usd,
      render: (c) => fmtCost(c.cost_usd),
    },
    {
      key: "latency", header: "Latency", numeric: true, width: "12%",
      sortValue: (c) => c.latency_ms,
      render: (c) => fmtLatency(c.latency_ms),
    },
  ], []);

  if (!data && error) {
    return <ErrorState message={error} onRetry={() => { setError(null); setReloadKey((k) => k + 1); }} />;
  }
  if (!data) return <p className="loading">Loading…</p>;

  const win = windowLabel(Number(hours));
  const errTone = data.failure_rate >= 5 ? "danger" : data.failure_rate > 0 ? "warn" : "ok";
  const fnOptions = [...new Set(data.by_function.map((r) => r.function))].sort();
  const selected = expandedId ? data.calls.find((c) => c.id === expandedId) ?? null : null;

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">Diagnostic</span>
        <h1>LLM calls</h1>
        <p>Find and inspect one AI call — its prompt in, response out, cost, latency, success.</p>
      </div>

      {/* ── Filter bar — the operator's find-that-one-call controls ──── */}
      <div className="filters">
        <select value={hours} onChange={(e) => handleHoursChange(e.target.value)}>
          <option value="1">Last hour</option>
          <option value="6">Last 6 hours</option>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
        </select>
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
          <option value="">All users</option>
          {data.users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
        </select>
        {schools.length > 0 && (
          <select value={schoolFilter} onChange={(e) => setParam("school", e.target.value)}>
            <option value="">All schools</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <select value={fnFilter} onChange={(e) => setFnFilter(e.target.value)}>
          <option value="">All functions</option>
          {fnOptions.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={status} onChange={(e) => setParam("status", e.target.value)}>
          <option value="">Any status</option>
          <option value="ok">Succeeded</option>
          <option value="failed">Failed</option>
        </select>
        <SearchInput value={search} onChange={setSearch} placeholder="Search prompt + response…" />
        {submissionFilter && (
          <button className="filter-badge" onClick={() => setParam("submission", "")} style={{ cursor: "pointer", border: "none" }} title={submissionFilter}>
            Submission: {shortId(submissionFilter)} ✕
          </button>
        )}
        {sessionFilter && (
          <button className="filter-badge" onClick={() => setParam("session", "")} style={{ cursor: "pointer", border: "none" }} title={sessionFilter}>
            Session: {shortId(sessionFilter)} ✕
          </button>
        )}
      </div>

      {/* ── ① Strip — the window's headline health + failing functions ── */}
      <div className="tile-grid">
        <StatTile label="Total calls" value={data.total_count_window.toLocaleString()} sub={`in the last ${win}`} />
        <StatTile label={`Cost (${win})`} value={fmtCost(data.total_cost_window)} sub="across all functions" />
        <StatTile
          label="Failure rate" tone={errTone} value={`${data.failure_rate}%`}
          sub={`${data.failure_count.toLocaleString()}/${data.total_count_window.toLocaleString()} calls`}
        />
        <StatTile label="p95 latency" value={fmtLatency(data.p95_latency_ms)} sub={`tail of ${win}`} />
      </div>

      {data.failures_by_function.length > 0 && (
        <div className="table-card">
          <h3>Failing functions · {win}</h3>
          <DataTable
            columns={failCols}
            rows={data.failures_by_function}
            rowKey={(r) => r.function}
            defaultSort={{ key: "count", dir: "desc" }}
            onRowClick={(r) => { setFnFilter(r.function); setParam("status", "failed"); }}
            rowStatus={() => "var(--danger)"}
            minWidth={360}
          />
        </div>
      )}

      {/* ── ② The primary surface — one searchable, sortable call table ── */}
      <div className="table-card">
        <h3>Calls {data.total_count > 0 && <span className="llm-count">({data.total_count.toLocaleString()})</span>}</h3>
        <DataTable
          columns={columns}
          rows={data.calls}
          rowKey={(c) => c.id}
          defaultSort={{ key: "created_at", dir: "desc" }}
          onRowClick={(c) => setExpandedId(expandedId === c.id ? null : c.id)}
          rowStatus={(c) => (c.id === expandedId ? "var(--accent)" : !c.success ? "var(--danger)" : undefined)}
          empty={<span className="dt-state-title">No calls match these filters.</span>}
          minWidth={720}
        />
        <Pagination offset={offset} limit={PAGE_SIZE} total={data.total_count} onChange={setOffset} />
      </div>

      {/* ── ③ A level away — the exact input | output for one call ────── */}
      {selected && (
        <div className="table-card llm-detail">
          <div className="llm-detail-head">
            <div className="llm-detail-title">
              <StatusPill tone={selected.success ? "ok" : "danger"} label={selected.success ? "OK" : "FAIL"} />
              <strong>{selected.function}</strong>
              <span className="llm-detail-meta" title={selected.model}>{shortModel(selected.model)}</span>
              <span className="llm-detail-meta">{fmtCost(selected.cost_usd)}</span>
              <span className="llm-detail-meta">{fmtLatency(selected.latency_ms)}</span>
              <span className="llm-detail-meta">{selected.input_tokens}/{selected.output_tokens} tok</span>
              <span className="llm-detail-meta" title={new Date(selected.created_at).toLocaleString()}>{formatRelativeDate(selected.created_at)}</span>
            </div>
            <button className="llm-detail-close" onClick={() => setExpandedId(null)} aria-label="Close">✕</button>
          </div>

          <div className="call-detail-row">
            <div className="call-detail-section">
              <div className="llm-io-head">
                <strong>Input</strong>
                <CopyButton text={selected.input_text ?? ""} disabled={!selected.input_text} />
              </div>
              <pre>{selected.input_text || "(not captured)"}</pre>
            </div>
            <div className="call-detail-section">
              <div className="llm-io-head">
                <strong>{selected.success ? "Output" : "Error"}</strong>
                <CopyButton text={selected.output_text ?? ""} disabled={!selected.output_text} />
              </div>
              <pre>{selected.output_text || "(not captured)"}</pre>
            </div>
          </div>

          <div className="call-detail-metadata">
            <strong>Metadata</strong>
            <MetadataChips
              metadata={selected.metadata}
              schoolId={selected.school_id}
              submissionId={selected.submission_id}
              onSubmissionClick={(id) => setParam("submission", id)}
            />
            <div className="llm-detail-actions">
              {selected.session_id && (
                <button className="llm-link-btn" onClick={() => { setParam("session", selected.session_id!); setExpandedId(null); }}>
                  ⧉ View session calls →
                </button>
              )}
              {selected.submission_id && (
                <Link to={tracePathFor(selected.submission_id)} className="llm-link-btn">
                  ▤ Open flight recorder →
                </Link>
              )}
              <button
                className="llm-link-btn"
                onClick={() => handleDebug(selected.id)}
                disabled={debugState[selected.id] === "sending"}
              >
                🔍 Debug with agent
              </button>
              {(debugState[selected.id] === "sent" || Boolean(selected.metadata?.debug_dispatched_at)) && (
                <a
                  href={`https://github.com/${data.repo}/issues?q=${encodeURIComponent(`is:issue label:llm-debug ${selected.id}`)}`}
                  target="_blank" rel="noopener noreferrer" className="llm-link-btn"
                  title="Open the debug agent's findings for this call on GitHub"
                >
                  🔗 Debug results
                </a>
              )}
            </div>
            {debugState[selected.id] === "sending" && <div className="llm-detail-note">Dispatching…</div>}
            {debugState[selected.id] === "sent" && <div className="llm-detail-note llm-note-ok">Dispatched — results appear under 🔗 once the agent finishes.</div>}
            {debugState[selected.id] === "error" && <div className="llm-detail-note llm-note-bad">Dispatch failed (token configured?).</div>}
          </div>
        </div>
      )}

      {/* ── Trends — demoted; the aggregate view, a click away ────────── */}
      <details className="llm-trends">
        <summary>Trends &amp; aggregates · {win}</summary>
        <div className="chart-row">
          <div className="chart-card">
            <h3>Calls / day</h3>
            <ResponsiveContainer width="100%" height={220}>
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
            <h3>Cost / day ($)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data.by_day}>
                <CartesianGrid strokeDasharray="2 4" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip formatter={(v) => `$${Number(v).toFixed(4)}`} />
                <Area type="monotone" dataKey="cost" stroke="#b8431a" fill="#b8431a1a" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-row">
          <div className="chart-card">
            <h3>Cost by model</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data.by_model} dataKey="total_cost" nameKey="model"
                  cx="50%" cy="50%" outerRadius={78}
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                >
                  {data.by_model.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend />
                <Tooltip formatter={(v) => `$${Number(v).toFixed(4)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-card">
            <h3>Avg latency / day (ms)</h3>
            <ResponsiveContainer width="100%" height={220}>
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

        <div className="table-card">
          <h3>By function</h3>
          <DataTable
            columns={byFnCols}
            rows={data.by_function}
            rowKey={(r) => r.function}
            defaultSort={{ key: "total_cost", dir: "desc" }}
            onRowClick={(r) => setFnFilter(r.function)}
            minWidth={520}
          />
        </div>
      </details>
    </div>
  );
}

const failCols: Column<LLMCallsData["failures_by_function"][number]>[] = [
  { key: "function", header: "Function", width: "50%", render: (r) => r.function },
  { key: "count", header: "Fails", numeric: true, width: "25%", sortValue: (r) => r.count, render: (r) => r.count.toLocaleString() },
  { key: "avg_retries", header: "Avg retries", numeric: true, width: "25%", sortValue: (r) => r.avg_retries, render: (r) => r.avg_retries.toFixed(1) },
];

const byFnCols: Column<LLMCallsData["by_function"][number]>[] = [
  { key: "function", header: "Function", width: "40%", render: (r) => r.function },
  { key: "count", header: "Calls", numeric: true, width: "20%", sortValue: (r) => r.count, render: (r) => r.count.toLocaleString() },
  { key: "total_cost", header: "Cost", numeric: true, width: "20%", sortValue: (r) => r.total_cost, render: (r) => fmtCost(r.total_cost) },
  { key: "avg_latency_ms", header: "Avg latency", numeric: true, width: "20%", sortValue: (r) => r.avg_latency_ms, render: (r) => fmtLatency(r.avg_latency_ms) },
];

function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      disabled={disabled}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "Copied ✓" : "Copy"}
    </button>
  );
}
