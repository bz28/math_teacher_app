import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  type SchoolListItem,
  type TimelineData,
  type TimelineEntry,
} from "../lib/api";
import { renderChipValue, shortId } from "../lib/format";
import { windowLabel } from "../lib/definitions";
import { BOARD_PAGE_SIZE } from "../lib/pagination";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import { Pagination, SearchInput } from "../components/Pagination";

/**
 * Audit log — the compliance/forensic surface. One chronological
 * timeline merges the two trails that used to live in separate tabs:
 *  - Record access (FERPA reads: a teacher/admin opening a student's
 *    grades, submissions, integrity flags, sessions).
 *  - Writes (actions: publishes, generation starts, grade saves, role
 *    changes, deletes).
 * Merging them onto one clock lets an operator see a record-read and
 * the write that caused it side by side — and answer the two questions
 * districts actually ask: "who touched student X's records?" and "who
 * did what, when?" Everything is URL-driven so a filtered view is a
 * shareable deep link, and the same filter drives the CSV export.
 */

// Date-range presets → the backend `hours` window. "" = all-time.
const RANGES: { value: string; label: string }[] = [
  { value: "24", label: "Last 24 hours" },
  { value: "168", label: "Last 7 days" },
  { value: "720", label: "Last 30 days" },
  { value: "", label: "All time" },
];

const DEFAULT_HOURS = "168";

function actionLabel(e: TimelineEntry): string {
  if (e.action) return e.action;
  if (e.record_type) return `read · ${e.record_type}`;
  return "—";
}

export default function AuditLogs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<TimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schools, setSchools] = useState<SchoolListItem[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const hours = searchParams.get("hours") ?? DEFAULT_HOURS;
  const q = searchParams.get("q") ?? "";
  const schoolId = searchParams.get("school_id") ?? "";
  const facet = searchParams.get("facet") ?? "";
  const typeFilter = searchParams.get("type") ?? "";
  const target = searchParams.get("target") ?? "";
  const offset = Number(searchParams.get("offset") ?? "0");
  // The page the rows on screen belong to. `offset` moves the moment the
  // pager is clicked, so comparing the two tells us the table is showing
  // the previous page under the new label — see Users.tsx.
  const [loadedOffset, setLoadedOffset] = useState(0);

  // The filter fields, minus pagination — shared by the fetch and the
  // CSV export so the download is always exactly what's on screen.
  const filterParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (hours) p.hours = hours;
    if (q) p.q = q;
    if (schoolId) p.school_id = schoolId;
    if (facet) p.facet = facet;
    if (typeFilter) p.type = typeFilter;
    if (target) p.target_id = target;
    return p;
  }, [hours, q, schoolId, facet, typeFilter, target]);

  useEffect(() => {
    let cancelled = false;
    api
      .auditTimeline({ ...filterParams, limit: String(BOARD_PAGE_SIZE), offset: String(offset) })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoadedOffset(offset);
          setError(null);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        // Clear the in-flight marker too, or the table sits on the loading
        // skeleton forever: DataTable renders loading before error, so the
        // message and its Retry never appear.
        setLoadedOffset(offset);
        setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [filterParams, offset, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    api
      .schools()
      .then((r) => {
        if (!cancelled) setSchools(r.schools);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("offset");
    setSearchParams(params);
  }

  function updateOffset(next: number) {
    const params = new URLSearchParams(searchParams);
    if (next > 0) params.set("offset", String(next));
    else params.delete("offset");
    setSearchParams(params);
  }

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      await api.downloadAuditTimelineCsv(filterParams);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const summary = data?.summary;
  const win = hours ? windowLabel(Number(hours)) : "all-time";
  const byDay = summary?.by_day ?? [];
  const todayISO = new Date().toISOString().slice(0, 10);
  const todayCount = byDay.find((d) => d.day === todayISO)?.count ?? 0;

  const columns: Column<TimelineEntry>[] = [
    {
      key: "at",
      header: "When",
      width: "160px",
      sortValue: (e) => e.at,
      render: (e) => (
        <span title={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleString()}</span>
      ),
    },
    {
      key: "facet",
      header: "Kind",
      width: "92px",
      render: (e) => (
        <StatusPill
          tone={e.facet === "access" ? "info" : "neutral"}
          label={e.facet === "access" ? "READ" : "WRITE"}
        />
      ),
    },
    {
      key: "actor",
      header: "Actor",
      render: (e) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink)", fontWeight: 500 }}>{e.actor_name ?? "—"}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {e.actor_email ?? (e.actor_user_id ? shortId(e.actor_user_id) : "")}
            {e.actor_role ? ` · ${e.actor_role}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      sortValue: (e) => actionLabel(e),
      render: (e) => (
        <span className="mono" style={{ fontSize: 12 }}>
          {actionLabel(e)}
        </span>
      ),
    },
    {
      key: "target",
      header: "Target",
      render: (e) => <TargetCell e={e} onPivot={(id) => setParam("target", id)} />,
    },
    {
      key: "ip",
      header: "IP",
      width: "128px",
      render: (e) => (
        <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>
          {e.ip_address ?? "—"}
        </span>
      ),
    },
    {
      key: "meta",
      header: "Details",
      render: (e) => <MetadataCell e={e} />,
    },
  ];

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">Compliance</span>
        <h1>Audit log</h1>
        <p>
          One trail of every record access and action — who touched a
          student&apos;s records, and who did what, when. Filter it down and
          hand a district a clean export.
        </p>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────── */}
      <div
        className="filters"
        style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
      >
        <select
          aria-label="Date range"
          value={hours}
          onChange={(e) => setParam("hours", e.target.value)}
        >
          {RANGES.map((r) => (
            <option key={r.value || "all"} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <SearchInput
          value={q}
          onChange={(v) => setParam("q", v.trim())}
          placeholder="Actor or student — name / email"
          ariaLabel="Search by actor or student name or email"
        />
        <select
          aria-label="School"
          value={schoolId}
          onChange={(e) => setParam("school_id", e.target.value)}
        >
          <option value="">All schools</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Event kind"
          value={facet}
          onChange={(e) => setParam("facet", e.target.value)}
        >
          <option value="">All events</option>
          <option value="access">Record access</option>
          <option value="write">Writes</option>
        </select>
        <SearchInput
          value={typeFilter}
          onChange={(v) => setParam("type", v.trim())}
          placeholder="Action / record type"
          ariaLabel="Filter by action or record type"
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={exportCsv}
          disabled={exporting}
          title="Download the current filtered trail as CSV"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
        {target && (
          <button
            type="button"
            className="filter-badge"
            onClick={() => setParam("target", "")}
            style={{ cursor: "pointer", border: "none" }}
            title="Clear the target pivot"
          >
            Pivoted to {shortId(target)} ✕
          </button>
        )}
      </div>
      {exportError && <p className="error">{exportError}</p>}

      {/* ── Scope summary ──────────────────────────────────────────── */}
      <div className="tile-grid">
        <StatTile
          label="Total events"
          value={(summary?.total ?? 0).toLocaleString()}
          sub={`in scope · ${win}`}
        />
        <StatTile
          label="Distinct actors"
          value={(summary?.distinct_actors ?? 0).toLocaleString()}
          sub="people who touched records"
        />
        <StatTile
          label="Top action"
          value={
            <span style={{ fontSize: 17, fontFamily: "var(--font-mono)" }}>
              {summary?.top_action ?? "—"}
            </span>
          }
          sub={
            summary?.top_action ? `×${summary.top_action_count.toLocaleString()}` : "no events"
          }
        />
        <StatTile
          label="Events today"
          value={todayCount.toLocaleString()}
          sub="daily trend →"
          spark={byDay.map((d) => d.count)}
        />
        <StatTile
          label="Students accessed"
          value={(summary?.distinct_students ?? 0).toLocaleString()}
          sub="distinct FERPA records read"
        />
      </div>

      {/* ── Timeline ───────────────────────────────────────────────── */}
      <div className="table-card" style={{ marginTop: 8 }}>
        <DataTable
          columns={columns}
          rows={data?.entries ?? []}
          // Server-paged: one page of a larger set. <Pagination> below owns
          // paging, and client-side sort would rank only this page.
          serverPaged
          rowKey={(e) => `${e.facet}:${e.id}`}
          loading={(!data && !error) || (data !== null && loadedOffset !== offset)}
          error={error}
          onRetry={() => {
            setError(null);
            setReloadKey((k) => k + 1);
          }}
          rowStatus={(e) => (e.facet === "access" ? "var(--info)" : "var(--accent)")}
          empty={<span className="dt-state-title">No audit events match the current filter.</span>}
          minWidth={940}
        />
        {data && (
          <Pagination
            total={data.total}
            limit={data.limit}
            offset={data.offset}
            onChange={updateOffset}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Target cell — never a dead UUID. For an access row the compliance
 * subject is the student, so it pivots the whole timeline to that
 * student ("every event touching them"). For a write it pivots to the
 * mutated entity, and a submission additionally deep-links to its trace.
 */
function TargetCell({ e, onPivot }: { e: TimelineEntry; onPivot: (id: string) => void }) {
  if (e.facet === "access") {
    return (
      <div style={{ minWidth: 0 }}>
        <button
          type="button"
          className="link-btn"
          disabled={!e.target_student_id}
          onClick={() => e.target_student_id && onPivot(e.target_student_id)}
          title="Show every event for this student"
        >
          {e.target_student_name ?? "student"}
        </button>
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
          {e.record_type}
          {e.target_id ? ` · ${shortId(e.target_id)}` : ""}
        </div>
      </div>
    );
  }

  const isSubmission = e.target_type === "submission" && e.target_id;
  return (
    <div style={{ minWidth: 0 }}>
      {isSubmission ? (
        <Link className="link-btn" to={`/submissions/${e.target_id}/trace`}>
          {e.target_type} ↗
        </Link>
      ) : (
        <button
          type="button"
          className="link-btn"
          disabled={!e.target_id}
          onClick={() => e.target_id && onPivot(e.target_id)}
          title="Show every event on this target"
        >
          {e.target_type ?? "—"}
        </button>
      )}
      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
        {e.target_id ? shortId(e.target_id) : "—"}
      </div>
    </div>
  );
}

/** Metadata — a one-line key:value summary that expands to full JSON. */
function MetadataCell({ e }: { e: TimelineEntry }) {
  const [open, setOpen] = useState(false);
  const meta = e.metadata;
  if (!meta || Object.keys(meta).length === 0) {
    return <span style={{ color: "var(--muted-2)" }}>—</span>;
  }
  const summary = Object.entries(meta)
    .map(([k, v]) => `${k}: ${renderChipValue(v)}`)
    .join(" · ");
  return (
    <div style={{ maxWidth: 320, minWidth: 0 }}>
      {open ? (
        <pre
          className="mono"
          style={{
            margin: 0,
            fontSize: 11.5,
            color: "var(--ink-soft)",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {JSON.stringify(meta, null, 2)}
        </pre>
      ) : (
        <div
          className="mono"
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {summary}
        </div>
      )}
      <button
        type="button"
        className="link-btn"
        style={{ fontSize: 11 }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "collapse" : "expand"}
      </button>
    </div>
  );
}
