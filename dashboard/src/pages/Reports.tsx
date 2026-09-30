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
            {/* The sienna rule is the open signal; say it for screen readers. */}
            {r.status === "open" && <span className="sr-only">Open. </span>}
            <span className="rpt-where-main" title={r.submission_id ? undefined : (pagePath(r.page_url) ?? undefined)}>
              {!r.submission_id && <span className="rpt-where-tag">Sidebar</span>}
              {whereLabel(r)}
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
        key: "grades",
        header: "AI → teacher",
        width: "150px",
        numeric: true,
        // Sorted by the size of the disagreement — a 60-point miss matters
        // whichever way it points. No grades sorts last.
        sortValue: (r) => {
          const gap = gradeGap(r);
          return gap === null ? -1 : Math.abs(gap);
        },
        render: (r) => <GradeCell r={r} />,
      },
      {
        key: "when",
        header: "When",
        width: "160px",
        sortValue: (r) => r.created_at,
        render: (r) => (
          <span className="muted">
            {formatRelativeDate(r.created_at)}
            {r.status === "resolved" && <span className="rpt-resolved"> · resolved</span>}
          </span>
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

/** "100 → 40 · −60": both grades and the gap, the gap in the alert tone
 *  when they disagree. Blank when there's no grade to compare — a sidebar
 *  report, or a whole-submission one. */
function GradeCell({ r }: { r: TeacherReportData }) {
  const ai = gradeValue(r.ai_grade);
  const teacher = gradeValue(r.teacher_grade);
  if (ai === null && teacher === null) return null;
  const gap = gradeGap(r);
  return (
    <span className="rpt-grades-cell">
      {ai ?? "—"} → {teacher ?? "—"}
      {gap !== null && (
        <>
          {" · "}
          <strong
            className={gap === 0 ? "rpt-gap rpt-gap-zero" : "rpt-gap"}
            title={gap < 0 ? "The AI gave more credit than the teacher" : gap > 0 ? "The AI gave less credit than the teacher" : "Same grade"}
          >
            {fmtGap(gap)}
          </strong>
        </>
      )}
    </span>
  );
}
