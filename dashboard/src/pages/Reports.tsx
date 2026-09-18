import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type ReportStatus, type TeacherReportData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import { KIND_LABEL, KIND_TONE, gradePct, whereLabel } from "../lib/reports";
import DataTable, { type Column } from "../components/DataTable";
import StatusPill from "../components/StatusPill";

/**
 * Teacher reports — every "Report a problem" a teacher has filed from
 * the product, open first. This is the inbox behind the alert email:
 * the email says "look", this page is where you look, and the detail
 * page is where you close it out.
 */

type Filter = ReportStatus | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

export default function Reports() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("status") as Filter | null) ?? "open";
  const [rows, setRows] = useState<TeacherReportData[]>([]);
  const [counts, setCounts] = useState<Record<ReportStatus, number>>({ open: 0, resolved: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped to refetch after an error; the filter change refetches by
  // itself. Loading/error flip inside the promise chain, not the
  // effect body, which is what the set-state-in-effect rule wants.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .reports(filter)
      .then((d) => {
        if (cancelled) return;
        setRows(d.reports);
        setCounts(d.counts);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, attempt]);
  const load = useCallback(() => {
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  const columns = useMemo<Column<TeacherReportData>[]>(
    () => [
      {
        key: "when",
        header: "When",
        width: "110px",
        sortValue: (r) => r.created_at,
        render: (r) => <span className="muted">{formatRelativeDate(r.created_at)}</span>,
      },
      {
        key: "teacher",
        header: "Teacher",
        width: "160px",
        sortValue: (r) => r.teacher_name ?? "",
        render: (r) => <strong>{r.teacher_name ?? "—"}</strong>,
      },
      {
        key: "where",
        header: "Where",
        sortValue: (r) => whereLabel(r),
        render: (r) => whereLabel(r),
      },
      {
        key: "kind",
        header: "Kind",
        width: "170px",
        sortValue: (r) => r.kind,
        render: (r) => <StatusPill tone={KIND_TONE[r.kind]} label={KIND_LABEL[r.kind]} />,
      },
      {
        key: "grades",
        header: "AI → teacher",
        width: "130px",
        render: (r) =>
          r.submission_id ? (
            <span className="mono">
              {gradePct(r.ai_grade)} → {gradePct(r.teacher_grade)}
            </span>
          ) : (
            <span className="muted">—</span>
          ),
      },
      {
        key: "status",
        header: "Status",
        width: "110px",
        sortValue: (r) => r.status,
        render: (r) => (
          <StatusPill
            tone={r.status === "open" ? "live" : "ok"}
            label={r.status === "open" ? "Open" : "Resolved"}
          />
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">From teachers</span>
        <h1>Reports</h1>
        <p>
          Problems teachers flagged from inside the product — a wrong grade, a misread page, a
          broken screen. Each one arrives with the submission, the AI's call and the teacher's grade
          attached. {counts.open} open · {counts.resolved} resolved.
        </p>
      </div>

      <div className="segmented" role="tablist" aria-label="Filter reports">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={f.key === filter}
            className={`segment${f.key === filter ? " segment-active" : ""}`}
            onClick={() => setParams(f.key === "open" ? {} : { status: f.key })}
          >
            {f.label}
            {f.key !== "all" && ` · ${counts[f.key]}`}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/reports/${r.id}`)}
        drill
        loading={loading}
        error={error}
        onRetry={load}
        defaultSort={{ key: "when", dir: "desc" }}
        searchKeys={(r) => [r.teacher_name, r.assignment_title, r.student_name, r.note, r.kind]}
        searchLabel="Search reports"
        empty={
          filter === "open"
            ? "No open reports — nothing's waiting on you."
            : "No reports here yet."
        }
      />
    </div>
  );
}
