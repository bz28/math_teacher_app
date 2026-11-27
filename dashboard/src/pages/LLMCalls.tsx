import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, LineChart, Line,
} from "recharts";
import { api, type LLMCallsData } from "../lib/api";
import { scopeParams, useSchoolScope } from "../lib/useSelectedSchool";
import { formatRelativeDate, shortModel, shortId, fmtCost, fmtLatency } from "../lib/format";
import AttentionBand from "../components/AttentionBand";
import CallDrawer from "../components/CallDrawer";
import { windowLabel } from "../lib/definitions";
import { BOARD_PAGE_SIZE } from "../lib/pagination";
import StatTile from "../components/StatTile";
import DataTable, { type Column } from "../components/DataTable";
import { Pagination, SearchInput } from "../components/Pagination";
import ErrorState from "../components/ErrorState";
import { useConfirm } from "../lib/confirm";

const COLORS = ["#14130f", "#4a6b3a", "#b8431a", "#3d5a78", "#a66b15", "#6b21a8"];

type CallRow = LLMCallsData["calls"][number];
type Status = "" | "ok" | "failed";


/** The calls-with-no-school bucket; the API takes it as a school_id. */
const INTERNAL_SCHOOL = "internal";
export default function LLMCalls() {
  const [searchParams, setSearchParams] = useSearchParams();
  const confirm = useConfirm();

  const [data, setData] = useState<LLMCallsData | null>(null);
  // Every filter is in the URL, so a link from any level (a school, a
  // teacher, a homework, a student, the attention band) lands on exactly
  // the calls it advertised, and the page can be shared as-is. Free-text
  // search stays local: it is the operator's live query.
  const hours = searchParams.get("hours") ?? "24";
  const dateFrom = searchParams.get("from") ?? "";
  const dateTo = searchParams.get("to") ?? "";
  const custom = Boolean(dateFrom || dateTo);
  const fnFilter = searchParams.get("function") ?? "";
  const [search, setSearch] = useState("");
  // `user` is "made the call"; `teacher` and `student` are the one
  // whose-call rule every level's numbers use; `assignment` is every call
  // on a submission to one homework.
  const userFilter = searchParams.get("user") ?? "";
  const teacherFilter = searchParams.get("teacher") ?? "";
  const studentFilter = searchParams.get("student") ?? "";
  const assignmentFilter = searchParams.get("assignment") ?? "";
  const submissionFilter = searchParams.get("submission") ?? "";
  const sessionFilter = searchParams.get("session") ?? "";
  const modelFilter = searchParams.get("model") ?? "";
  // The school comes from the rail's scope — except when the URL already
  // names one person, homework, submission or session. Those identify
  // their own rows, and ANDing a school on top can only hide them: an
  // admin's calls belong to no school. pageScope() treats these URLs as
  // single-thing pages for the same reason.
  const scope = useSchoolScope();
  const entityFilter = Boolean(
    userFilter || teacherFilter || studentFilter || assignmentFilter || submissionFilter || sessionFilter,
  );
  // `?school=internal` narrows to calls with no school (admin, internal
  // tools). The rail can't hold that bucket — its scope is a real school
  // or all of them — so the page keeps it in the URL as its own filter;
  // a school id in `?school=` is taken by the rail instead (Layout).
  const internalOnly = searchParams.get("school") === INTERNAL_SCHOOL;
  const schoolFilter = entityFilter ? null : internalOnly ? INTERNAL_SCHOOL : scope;
  const status: Status = ((): Status => {
    const s = searchParams.get("status");
    return s === "ok" || s === "failed" ? s : "";
  })();

  // Hold the selected call *object*, not its id: the list refetches on
  // every filter change, and the drawer must not blank when a refetch
  // drops its row.
  const [selectedCall, setSelectedCall] = useState<CallRow | null>(null);
  const [debugState, setDebugState] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  const [loadedOffset, setLoadedOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const query = useMemo(() => ({
    ...(custom ? { from: dateFrom, to: dateTo } : { hours }),
    function: fnFilter,
    model: modelFilter,
    user_id: userFilter,
    teacher_id: teacherFilter,
    student_id: studentFilter,
    assignment_id: assignmentFilter,
    submission_id: submissionFilter,
    session_id: sessionFilter,
    ...scopeParams(schoolFilter),
    search,
    ...(status === "ok" ? { success: "true" } : status === "failed" ? { success: "false" } : {}),
  }), [custom, dateFrom, dateTo, hours, fnFilter, modelFilter, userFilter, teacherFilter, studentFilter, assignmentFilter, submissionFilter, sessionFilter, schoolFilter, search, status]);

  useEffect(() => {
    let cancelled = false;
    const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== ""));
    api.llmCalls({ ...params, limit: String(BOARD_PAGE_SIZE), offset: String(offset) })
      .then((d) => { if (!cancelled) { setData(d); setLoadedOffset(offset); setError(null); } })
      .catch((e) => {
        if (cancelled) return;
        // Mark this offset loaded even though it failed: that ends the
        // in-flight state so DataTable reaches the message and its Retry.
        setLoadedOffset(offset);
        setError(e instanceof Error ? e.message : "Failed to load LLM calls.");
      });
    return () => { cancelled = true; };
  }, [query, offset, reloadKey]);

  // A filter change can leave the page past the end of a smaller result.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset(0);
  }, [query]);

  const setParams = (changes: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    setSearchParams(next);
  };
  const setParam = (key: string, value: string) => setParams({ [key]: value });
  const pickFunction = (fn: string) => setParam("function", fn);
  // A band line describes the last 24h of the band's own scope — the
  // school, nothing narrower — so following one drops every narrower
  // filter, or the list it lands on is a different set of calls.
  const followBand = (changes: Record<string, string>) => setParams({
    user: "", teacher: "", student: "", assignment: "", submission: "", session: "", model: "",
    function: "", hours: "", from: "", to: "", ...changes,
  });

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
      key: "created_at", header: "When", width: "10%",
      sortValue: (c) => new Date(c.created_at).getTime(),
      render: (c) => (
        <span title={new Date(c.created_at).toLocaleString()}>{formatRelativeDate(c.created_at)}</span>
      ),
    },
    {
      key: "who", header: "School · teacher · student", width: "22%",
      render: (c) => {
        const who = [c.school_name ?? "Internal", c.teacher_name, c.student_name].filter(Boolean);
        return (
          <div style={{ minWidth: 0 }}>
            <div className="calls-who">{who.join(" · ")}</div>
            {!c.student_name && c.user_name && <div className="llm-ctx">by {c.user_name}</div>}
          </div>
        );
      },
    },
    {
      key: "function", header: "Function", width: "16%",
      render: (c) => (
        <div style={{ minWidth: 0 }}>
          <div className="calls-fn">{c.function}</div>
          <div className="llm-ctx">
            {c.deleted_submission && <span className="llm-ctx-tag" title="Its submission was deleted; the call stays with the student who made it">▤ deleted submission</span>}
            {c.session_id && <span className="llm-ctx-tag" title={`session ${c.session_id}`}>⧉ {shortId(c.session_id)}</span>}
          </div>
        </div>
      ),
    },
    {
      key: "model", header: "Model", width: "8%",
      render: (c) => <span title={c.model} className="calls-muted">{shortModel(c.model)}</span>,
    },
    {
      key: "status", header: "Status", width: "14%",
      sortValue: (c) => (c.success ? 1 : 0),
      render: (c) => (
        <span className={c.success ? "calls-ok" : "calls-bad"}>
          {c.success ? "OK" : "Failed"}
          {c.retry_count > 0 && ` · ${c.retry_count} ${c.retry_count === 1 ? "retry" : "retries"}`}
        </span>
      ),
    },
    {
      key: "tokens", header: "Tokens in→out", numeric: true, width: "13%",
      sortValue: (c) => c.input_tokens,
      render: (c) => `${c.input_tokens.toLocaleString()} → ${c.output_tokens.toLocaleString()}`,
    },
    {
      key: "latency", header: "Latency", numeric: true, width: "8%",
      sortValue: (c) => c.latency_ms,
      render: (c) => fmtLatency(c.latency_ms),
    },
    {
      key: "cost", header: "Cost", numeric: true, width: "9%",
      sortValue: (c) => c.cost_usd,
      render: (c) => fmtCost(c.cost_usd),
    },
  ], []);

  if (!data && error) {
    return <ErrorState message={error} onRetry={() => { setError(null); setLoadedOffset(null); setReloadKey((k) => k + 1); }} />;
  }
  if (!data) return <p className="loading">Loading…</p>;

  const win = custom ? `${dateFrom || "start"} → ${dateTo || "today"}` : windowLabel(Number(hours));
  const sum = data.summary;
  const errTone = sum.failure_rate >= 5 ? "danger" : sum.failure_rate > 0 ? "warn" : "ok";
  // Every filter narrows the strip as well as the table, so say so when
  // one is on — a filtered total must not read as the window's.
  const narrowed = Boolean(fnFilter || modelFilter || status || search || entityFilter);
  const badges: { key: string; label: string; title: string }[] = [
    internalOnly && !entityFilter && { key: "school", label: "Internal only", title: "Calls that belong to no school" },
    assignmentFilter && { key: "assignment", label: `Homework: ${shortId(assignmentFilter)}`, title: "Every call on a submission to this homework" },
    submissionFilter && { key: "submission", label: `Submission: ${shortId(submissionFilter)}`, title: submissionFilter },
    sessionFilter && { key: "session", label: `Session: ${shortId(sessionFilter)}`, title: sessionFilter },
  ].filter((b): b is { key: string; label: string; title: string } => Boolean(b));

  return (
    <div className={selectedCall ? "calls-page with-drawer" : "calls-page"}>
      <div className="page-header calls-header">
        <div>
          <span className="eyebrow">Debug</span>
          <h1>Calls</h1>
          <p>Every AI call — find the failing one, see exactly what it sent and got back.</p>
        </div>
        <div className="calls-window">
          <select
            aria-label="Time window" value={custom ? "custom" : hours}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") {
                const today = new Date().toISOString().slice(0, 10);
                setParams({ hours: "", from: today, to: today });
              } else {
                setParams({ hours: v === "24" ? "" : v, from: "", to: "" });
              }
            }}
          >
            <option value="1">Last hour</option>
            <option value="6">Last 6 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="168">Last 7 days</option>
            <option value="720">Last 30 days</option>
            <option value="2160">Last 90 days</option>
            <option value="custom">Custom…</option>
          </select>
          {custom && (
            <>
              <input type="date" aria-label="From" value={dateFrom} max={dateTo || undefined} onChange={(e) => setParam("from", e.target.value)} />
              <span className="calls-muted">→</span>
              <input type="date" aria-label="To" value={dateTo} min={dateFrom || undefined} onChange={(e) => setParam("to", e.target.value)} />
            </>
          )}
        </div>
      </div>

      {/* What needs a human now — each line a link into its calls. */}
      <AttentionBand
        schoolId={schoolFilter}
        onFunction={(fn, failedOnly) => followBand({ function: fn, status: failedOnly ? "failed" : "" })}
        onSchool={(id) => followBand({ school: id, status: "failed" })}
      />

      {/* ── Filters — every one narrows the numbers and the rows ─────── */}
      <div className="filters">
        <select aria-label="Filter by teacher" value={teacherFilter} onChange={(e) => setParam("teacher", e.target.value)}>
          <option value="">All teachers</option>
          {withCurrent(data.teachers, teacherFilter).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select aria-label="Filter by student" value={studentFilter} onChange={(e) => setParam("student", e.target.value)}>
          <option value="">All students</option>
          {withCurrent(data.students, studentFilter).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select aria-label="Filter by function" value={fnFilter} onChange={(e) => pickFunction(e.target.value)}>
          <option value="">All functions</option>
          {withCurrent(data.functions.map((f) => ({ id: f, name: f })), fnFilter).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select aria-label="Filter by model" value={modelFilter} onChange={(e) => setParam("model", e.target.value)}>
          <option value="">All models</option>
          {withCurrent(data.models.map((m) => ({ id: m, name: shortModel(m) })), modelFilter).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select aria-label="Filter by status" value={status} onChange={(e) => setParam("status", e.target.value)}>
          <option value="">Any status</option>
          <option value="ok">Succeeded</option>
          <option value="failed">Failed</option>
        </select>
        <select aria-label="Filter by who made the call" value={userFilter} onChange={(e) => setParam("user", e.target.value)}>
          <option value="">Made by anyone</option>
          {withCurrent(data.users.map((u) => ({ id: u.id, name: u.email })), userFilter).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <SearchInput value={search} onChange={setSearch} placeholder="Search input / output…" />
        {badges.map((b) => (
          <button key={b.key} className="filter-badge" onClick={() => setParam(b.key, "")} title={b.title}>
            {b.label} ✕
          </button>
        ))}
      </div>

      {/* ── The strip — follows every filter ─────────────────────────── */}
      <div className="tile-grid">
        <StatTile
          label="Calls" value={sum.calls.toLocaleString()}
          sub={narrowed ? `filtered · ${win} · totals follow filters` : `in ${custom ? win : `the last ${win}`}`}
        />
        <StatTile label="Spend" value={fmtCost(sum.spend)} sub={narrowed ? "of the filtered calls" : "across all functions"} />
        <StatTile
          label="Failed" tone={errTone} value={sum.failed.toLocaleString()}
          sub={`${sum.failure_rate}% of ${sum.calls.toLocaleString()} calls`}
        />
        <StatTile label="p50" value={fmtLatency(sum.latency_p50_ms)} sub="successful calls" />
        <StatTile
          label="p95" value={fmtLatency(sum.latency_p95_ms)}
          sub={`successful calls · n=${sum.latency_n.toLocaleString()}`}
        />
      </div>

      {/* ── The table ────────────────────────────────────────────────── */}
      <div className="table-card">
        <h3>Calls {data.total_count > 0 && <span className="llm-count">({data.total_count.toLocaleString()})</span>}</h3>
        <DataTable
          columns={columns}
          rows={data.calls}
          serverPaged
          rowKey={(c) => c.id}
          loading={loadedOffset !== offset}
          error={error}
          onRetry={() => { setError(null); setLoadedOffset(null); setReloadKey((k) => k + 1); }}
          onRowClick={(c) => setSelectedCall(c)}
          rowStatus={(c) => (c.id === selectedCall?.id ? "var(--accent)" : !c.success ? "var(--danger)" : undefined)}
          empty={<span className="dt-state-title">No calls match these filters.</span>}
          minWidth={1000}
        />
        <Pagination offset={offset} limit={BOARD_PAGE_SIZE} total={data.total_count} onChange={setOffset} />
      </div>

      {selectedCall && (
        <CallDrawer
          call={selectedCall}
          repo={data.repo}
          debugState={debugState[selectedCall.id]}
          onClose={() => setSelectedCall(null)}
          onDebug={() => handleDebug(selectedCall.id)}
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

        {data.failures_by_function.length > 0 && (
          <div className="table-card">
            <h3>Failing functions</h3>
            <DataTable
              columns={failCols}
              rows={data.failures_by_function}
              rowKey={(r) => r.function}
              defaultSort={{ key: "count", dir: "desc" }}
              onRowClick={(r) => setParams({ function: r.function, status: "failed" })}
              rowStatus={() => "var(--danger)"}
              unpaged
              minWidth={360}
            />
          </div>
        )}

        <div className="table-card">
          <h3>By function</h3>
          <DataTable
            columns={byFnCols}
            rows={data.by_function}
            rowKey={(r) => r.function}
            defaultSort={{ key: "total_cost", dir: "desc" }}
            onRowClick={(r) => pickFunction(r.function)}
            unpaged
            minWidth={520}
          />
        </div>
      </details>
    </div>
  );
}

/** A picker's options, plus the current value when the list doesn't hold
 *  it (a link named someone outside this window or school), so the select
 *  shows the filter that is on rather than silently reading "All". */
function withCurrent(options: { id: string; name: string }[], current: string): { id: string; name: string }[] {
  if (!current || options.some((o) => o.id === current)) return options;
  return [{ id: current, name: shortId(current) }, ...options];
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

