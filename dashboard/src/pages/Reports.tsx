import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type ReportStatus, type TeacherReportData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import {
  KIND_LABEL,
  KIND_TONE,
  byPriority,
  fmtGap,
  gradeGap,
  gradeValue,
  pagePath,
  whereLabel,
} from "../lib/reports";
import DataTable, { type Column } from "../components/DataTable";
import StatusPill from "../components/StatusPill";

/**
 * Teacher reports — every "Report a problem" a teacher has filed from
 * the product. This is the inbox behind the alert email: the email says
 * "look", this page ranks what to look at, and the case view is where
 * you look and close it out.
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

  // The inbox order — open, then evidence attached, then newest. The
  // table keeps it until a header is clicked.
  const ranked = useMemo(() => [...rows].sort(byPriority), [rows]);

  const columns = useMemo<Column<TeacherReportData>[]>(
    () => [
      {
        key: "kind",
        header: "Kind",
        width: "184px",
        sortValue: (r) => r.kind,
        render: (r) => <StatusPill tone={KIND_TONE[r.kind]} label={KIND_LABEL[r.kind]} />,
      },
      {
        key: "where",
        header: "Where",
        sortValue: (r) => whereLabel(r),
        // What it's about, then what the teacher said — the note is what
        // decides which report to open first, so it rides under the where
        // instead of hiding a click away.
        render: (r) => (
          <div className="rpt-where">
            <span className="rpt-where-main">
              {r.submission_id ? (
                whereLabel(r)
              ) : (
                <>
                  <span className="rpt-where-tag">Sidebar</span>
                  <span className="mono">{pagePath(r.page_url) ?? "no page recorded"}</span>
                </>
              )}
            </span>
            {r.note && <span className="rpt-where-note">{r.note}</span>}
          </div>
        ),
      },
      {
        key: "teacher",
        header: "Teacher",
        width: "130px",
        sortValue: (r) => r.teacher_name ?? "",
        render: (r) => r.teacher_name ?? "—",
      },
      {
        key: "ai",
        header: "AI",
        width: "56px",
        numeric: true,
        sortValue: (r) => gradeValue(r.ai_grade) ?? -1,
        render: (r) => <GradeCell value={gradeValue(r.ai_grade)} />,
      },
      {
        key: "teacher_grade",
        header: "Tchr",
        width: "60px",
        numeric: true,
        sortValue: (r) => gradeValue(r.teacher_grade) ?? -1,
        render: (r) => <GradeCell value={gradeValue(r.teacher_grade)} />,
      },
      {
        key: "gap",
        header: "Gap",
        width: "76px",
        numeric: true,
        // Sorted by size — a 60-point miss matters whichever way it points.
        // No gap sorts below a real ±0, never alongside a 1-point one.
        sortValue: (r) => {
          const gap = gradeGap(r);
          return gap === null ? -1 : Math.abs(gap);
        },
        render: (r) => {
          const gap = gradeGap(r);
          return gap === null ? (
            <span className="muted">—</span>
          ) : (
            <strong
              className="rpt-gap"
              title={gap < 0 ? "The AI gave more credit than the teacher" : "The AI gave less credit than the teacher"}
            >
              {fmtGap(gap)}
            </strong>
          );
        },
      },
      {
        key: "when",
        header: "When",
        width: "92px",
        sortValue: (r) => r.created_at,
        render: (r) => <span className="muted">{formatRelativeDate(r.created_at)}</span>,
      },
      {
        key: "status",
        header: "Status",
        width: "112px",
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
          broken screen. Open reports with a submission attached come first: those you can
          diagnose right here. {counts.open} open · {counts.resolved} resolved.
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
        rows={ranked}
        rowKey={(r) => r.id}
        rowStatus={(r) => (r.status === "open" ? "var(--accent)" : undefined)}
        onRowClick={(r) => navigate(`/reports/${r.id}`)}
        drill
        loading={loading}
        error={error}
        onRetry={load}
        searchKeys={(r) => [r.teacher_name, r.assignment_title, r.student_name, r.note, r.kind]}
        searchLabel="reports"
        minWidth={900}
        empty={
          filter === "open"
            ? "No open reports — nothing's waiting on you."
            : "No reports here yet."
        }
      />
    </div>
  );
}

/** A grade as a bare mono number — the header names the side. */
function GradeCell({ value }: { value: number | null }) {
  return value === null ? <span className="muted">—</span> : <>{value}</>;
}
