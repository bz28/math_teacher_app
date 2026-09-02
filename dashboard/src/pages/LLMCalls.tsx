import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, LineChart, Line,
} from "recharts";
import { api, type LLMCallsData, type SchoolListItem } from "../lib/api";
import { formatRelativeDate, shortModel, shortId, fmtCost } from "../lib/format";
import { windowLabel } from "../lib/definitions";
import { BOARD_PAGE_SIZE } from "../lib/pagination";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import MetadataChips from "../components/MetadataChips";
import { Pagination, SearchInput } from "../components/Pagination";
import ErrorState from "../components/ErrorState";
import { EditorialModal } from "../components/EditorialModal";
import { useConfirm } from "../lib/confirm";

const COLORS = ["#14130f", "#4a6b3a", "#b8431a", "#3d5a78", "#a66b15", "#6b21a8"];

type CallRow = LLMCallsData["calls"][number];
type Status = "" | "ok" | "failed";

function fmtLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export default function LLMCalls() {
  const [searchParams, setSearchParams] = useSearchParams();
  const confirm = useConfirm();
  const tracePathFor = (submissionId: string) => `/submissions/${submissionId}/trace`;

  const [data, setData] = useState<LLMCallsData | null>(null);
  // Time window is URL-driven so deep links from Overview / SchoolDetail /
  // TeacherDetail ("View calls (30d)" → ?hours=720, failed calls → ?status=
  // failed) land on the window + scope they advertised.
  const [hours, setHours] = useState(searchParams.get("hours") ?? "24");
  // Function + free-text search are the operator's transient live query —
  // deliberately local (not URL-synced), unlike the deep-linkable scopes.
  const [fnFilter, setFnFilter] = useState("");
  const [search, setSearch] = useState("");
  // URL-driven scopes (deep-linkable, and the single source of truth so the
  // shown value and the URL can never disagree): user, submission, session,
  // school, status.
  const userFilter = searchParams.get("user") ?? "";
  const submissionFilter = searchParams.get("submission") ?? "";
  const sessionFilter = searchParams.get("session") ?? "";
  const schoolFilter = searchParams.get("school") ?? "";
  const status: Status = ((): Status => {
    const s = searchParams.get("status");
    return s === "ok" || s === "failed" ? s : "";
  })();

  // Hold the selected call *object*, not its id. The list refetches on every
  // filter change; an id looked up against `data.calls` would blank the open
  // modal the moment a refetch dropped that row. A snapshot always renders.
  const [selectedCall, setSelectedCall] = useState<CallRow | null>(null);
  const [debugState, setDebugState] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  // The page the rows on screen belong to. `offset` moves the moment the
  // pager is clicked, so comparing the two tells us the table is showing
  // the previous page under the new label — see Users.tsx.
  const [loadedOffset, setLoadedOffset] = useState(0);
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
      limit: String(BOARD_PAGE_SIZE),
      offset: String(offset),
    })
      .then((d) => { if (!cancelled) { setData(d); setLoadedOffset(offset); setError(null); } })
      .catch((e) => {
        if (cancelled) return;
        // Clear the in-flight marker too. Without it the table stays on the
        // loading skeleton forever — DataTable renders loading before error,
        // so the message and its Retry never appear.
        setLoadedOffset(offset);
        setError(e instanceof Error ? e.message : "Failed to load LLM calls.");
      });
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
    const ok = await confirm({
      title: "Dispatch a debugging agent?",
      message: "It runs on GitHub and posts its findings as an issue.",
      confirmLabel: "Dispatch",
    });
    if (!ok) return;
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

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">Diagnostic</span>
        <h1>LLM calls</h1>
        <p>Find and inspect one AI call — its prompt in, response out, cost, latency, success.</p>
      </div>

      {/* ── Filter bar — the operator's find-that-one-call controls ──── */}
      <div className="filters">
        <select aria-label="Time window" value={hours} onChange={(e) => handleHoursChange(e.target.value)}>
          <option value="1">Last hour</option>
          <option value="6">Last 6 hours</option>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
        </select>
        <select aria-label="Filter by user" value={userFilter} onChange={(e) => setParam("user", e.target.value)}>
          <option value="">All users</option>
          {data.users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
        </select>
        {schools.length > 0 && (
          <select aria-label="Filter by school" value={schoolFilter} onChange={(e) => setParam("school", e.target.value)}>
            <option value="">All schools</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <select aria-label="Filter by function" value={fnFilter} onChange={(e) => setFnFilter(e.target.value)}>
          <option value="">All functions</option>
          {fnOptions.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select aria-label="Filter by status" value={status} onChange={(e) => setParam("status", e.target.value)}>
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
            unpaged
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
          // Server-paged: one page of a larger set. <Pagination> below owns
          // paging, and client-side sort would rank only this page.
          serverPaged
          rowKey={(c) => c.id}
          loading={data !== null && loadedOffset !== offset}
          defaultSort={{ key: "created_at", dir: "desc" }}
          onRowClick={(c) => setSelectedCall(c)}
          rowStatus={(c) => (c.id === selectedCall?.id ? "var(--accent)" : !c.success ? "var(--danger)" : undefined)}
          empty={<span className="dt-state-title">No calls match these filters.</span>}
          minWidth={720}
        />
        <Pagination offset={offset} limit={BOARD_PAGE_SIZE} total={data.total_count} onChange={setOffset} />
      </div>

      {/* ── ③ One call, up front — prompt in, response out ───────────── */}
      {selectedCall && (
        <CallDetailModal
          call={selectedCall}
          repo={data.repo}
          debugState={debugState[selectedCall.id]}
          tracePath={selectedCall.submission_id ? tracePathFor(selectedCall.submission_id) : null}
          onClose={() => setSelectedCall(null)}
          onDebug={() => handleDebug(selectedCall.id)}
          // Both chips refilter the table underneath, so both dismiss — leaving
          // the modal up would silently rescope the list behind it.
          onSubmissionClick={(id) => { setParam("submission", id); setSelectedCall(null); }}
          onSessionClick={(id) => { setParam("session", id); setSelectedCall(null); }}
        />
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
            unpaged
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

/**
 * The one-call detail. Lives in a modal rather than inline under the table
 * because the panel used to render below all 25 rows — clicking the top row
 * put its prompt ~1600px below the fold with no scroll, so the click looked
 * like it did nothing.
 *
 * Input/output stack full-width and uncapped; the modal body is the single
 * scroll container. The old panel capped each <pre> at 300px with its own
 * scrollbar, which showed ~13% of a real (~1400-token) prompt and trapped
 * the wheel inside a box nested in a scrolling page.
 */
function CallDetailModal({
  call, repo, debugState, tracePath, onClose, onDebug, onSubmissionClick, onSessionClick,
}: {
  call: CallRow;
  repo: string;
  debugState: string | undefined;
  tracePath: string | null;
  onClose: () => void;
  onDebug: () => void;
  onSubmissionClick: (id: string) => void;
  onSessionClick: (id: string) => void;
}) {
  // On a failure the error is what you came for, so it leads.
  const io = call.success
    ? [{ label: "Input", text: call.input_text }, { label: "Output", text: call.output_text }]
    : [{ label: "Error", text: call.output_text }, { label: "Input", text: call.input_text }];

  return (
    <EditorialModal eyebrow="LLM call" title={call.function} onClose={onClose} maxWidth={1040}>
      <div className="llm-modal-body">
        <div className="llm-detail-title">
          <StatusPill tone={call.success ? "ok" : "danger"} label={call.success ? "OK" : "FAIL"} />
          <span className="llm-detail-meta" title={call.model}>{shortModel(call.model)}</span>
          <span className="llm-detail-meta">{call.user_name || "—"}</span>
          <span className="llm-detail-meta">{call.input_tokens}/{call.output_tokens} tok</span>
          {(call.cache_read_tokens > 0 || call.cache_write_tokens > 0) && (
            <span
              className="llm-detail-meta"
              title={`Prompt cache: ${call.cache_read_tokens} read at 0.1x input, ${call.cache_write_tokens} written at 1.25x input`}
            >
              cache {call.cache_read_tokens}r/{call.cache_write_tokens}w
            </span>
          )}
          <span className="llm-detail-meta">{fmtLatency(call.latency_ms)}</span>
          <span className="llm-detail-meta">{fmtCost(call.cost_usd)}</span>
          <span className="llm-detail-meta" title={new Date(call.created_at).toLocaleString()}>
            {formatRelativeDate(call.created_at)}
          </span>
        </div>

        <div className="llm-io">
          {io.map(({ label, text }) => (
            <div key={label} className="llm-io-section">
              <div className="llm-io-head">
                <strong>{label}</strong>
                <CopyButton text={text ?? ""} disabled={!text} />
              </div>
              <pre>{text || "(not captured)"}</pre>
            </div>
          ))}
        </div>

        <div className="llm-io-section">
          <strong>Metadata</strong>
          <MetadataChips
            metadata={call.metadata}
            schoolId={call.school_id}
            submissionId={call.submission_id}
            onSubmissionClick={onSubmissionClick}
          />
          <div className="llm-detail-actions">
            {call.session_id && (
              <button className="llm-link-btn" onClick={() => onSessionClick(call.session_id!)}>
                ⧉ View session calls →
              </button>
            )}
            {tracePath && (
              <Link to={tracePath} className="llm-link-btn">▤ Open flight recorder →</Link>
            )}
            <button className="llm-link-btn" onClick={onDebug} disabled={debugState === "sending"}>
              🔍 Debug with agent
            </button>
            {(debugState === "sent" || Boolean(call.metadata?.debug_dispatched_at)) && (
              <a
                href={`https://github.com/${repo}/issues?q=${encodeURIComponent(`is:issue label:llm-debug ${call.id}`)}`}
                target="_blank" rel="noopener noreferrer" className="llm-link-btn"
                title="Open the debug agent's findings for this call on GitHub"
              >
                🔗 Debug results
              </a>
            )}
          </div>
          {debugState === "sending" && <div className="llm-detail-note">Dispatching…</div>}
          {debugState === "sent" && <div className="llm-detail-note llm-note-ok">Dispatched — results appear under 🔗 once the agent finishes.</div>}
          {debugState === "error" && <div className="llm-detail-note llm-note-bad">Dispatch failed (token configured?).</div>}
        </div>
      </div>
    </EditorialModal>
  );
}

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
