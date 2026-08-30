import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type TeacherSubmissionsData } from "../lib/api";
import { fmtClockTime } from "../lib/format";
import DataTable, { type Column } from "./DataTable";
import StatusPill from "./StatusPill";

/**
 * The work handed in to this teacher — and the way into its trace.
 *
 * This page could tell you everything about what the TEACHER did and
 * nothing about what happened to the work, which is what a complaint is
 * almost always about. The Model calls panel below doesn't close the gap
 * either: grading and integrity calls are billed to the student whose
 * request they serve, so `ai_grading` and the four integrity functions
 * carry student ids and never appear here. On the current data that's
 * 120 of 138 calls — the teacher page could reach 13% of the model
 * traffic her classroom generates.
 *
 * `/submissions/:id/trace` already assembles the whole case file: every
 * call in pipeline order, wall time, failures, the grade, the integrity
 * disposition. Nothing in the console linked to it, so the only way in
 * was to type a UUID into the address bar. Every row here is that link.
 */

const PAGE = 25;

type Row = TeacherSubmissionsData["submissions"][number];

export default function TeacherSubmissions({ teacherId }: { teacherId: string }) {
  const [data, setData] = useState<TeacherSubmissionsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overriddenOnly, setOverriddenOnly] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const params: Record<string, string> = { limit: String(PAGE) };
    if (overriddenOnly) params.overridden_only = "true";
    api
      .teacherSubmissions(teacherId, params)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [teacherId, overriddenOnly, reloadKey]);

  const rows = data?.submissions ?? [];
  const overrides = rows.filter((r) => r.overridden).length;

  const columns: Column<Row>[] = [
    {
      key: "student",
      header: "Student",
      render: (r) => r.student_name ?? "—",
      sortValue: (r) => r.student_name ?? "",
    },
    {
      key: "assignment",
      header: "Assignment",
      render: (r) => r.assignment_title ?? "—",
      sortValue: (r) => r.assignment_title ?? "",
    },
    {
      key: "submitted",
      header: "Submitted",
      render: (r) => (
        <span className="mono" title={r.submitted_at ?? undefined}>
          {r.submitted_at ? fmtClockTime(r.submitted_at) : "—"}
          {r.is_late && <span className="muted"> late</span>}
        </span>
      ),
      sortValue: (r) => r.submitted_at ?? "",
    },
    {
      key: "score",
      header: "AI → final",
      align: "right",
      numeric: true,
      // The whole reason this column exists. Where a teacher CHANGED the
      // AI's score is where the AI was wrong, and it is the only quality
      // signal in the product that doesn't need a judge to produce it.
      render: (r) => {
        if (r.ai_score === null && r.final_score === null) return <span className="muted">—</span>;
        if (!r.overridden) return <span className="mono">{fmtScore(r.final_score ?? r.ai_score)}</span>;
        return (
          <span className="mono score-override">
            {fmtScore(r.ai_score)} → <strong>{fmtScore(r.final_score)}</strong>
          </span>
        );
      },
      sortValue: (r) => (r.overridden ? Math.abs(r.score_delta ?? 0) : -1),
    },
    {
      key: "integrity",
      header: "Integrity",
      render: (r) =>
        r.integrity_disposition === "flag_for_review" ? (
          <StatusPill tone="warn" label="review" />
        ) : r.integrity_status ? (
          <span className="muted mono">{r.integrity_status.replace(/_/g, " ")}</span>
        ) : (
          <span className="muted">—</span>
        ),
      sortValue: (r) => r.integrity_status ?? "",
    },
    {
      key: "calls",
      header: "Calls",
      align: "right",
      numeric: true,
      render: (r) =>
        r.failed_count > 0 ? (
          <span className="bad mono">
            {r.call_count} · {r.failed_count} failed
          </span>
        ) : (
          <span className="mono">{r.call_count || "—"}</span>
        ),
      sortValue: (r) => r.call_count,
    },
  ];

  return (
    <>
      {data && (
        <div className="panel-bar">
          <div className="panel-bar-facts">
            <span>
              <strong>{data.total.toLocaleString()}</strong> submission
              {data.total === 1 ? "" : "s"}
            </span>
            {overrides > 0 && (
              <span>
                <strong>{overrides}</strong> with a changed score
              </span>
            )}
          </div>
          <div className="panel-bar-controls">
            <label className="mini-check">
              <input
                type="checkbox"
                checked={overriddenOnly}
                onChange={(e) => setOverriddenOnly(e.target.checked)}
              />
              Score changed only
            </label>
          </div>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={data === null && !error}
        error={error}
        onRetry={() => setReloadKey((k) => k + 1)}
        drill
        onRowClick={(r) => navigate(`/submissions/${r.id}/trace`)}
        rowStatus={(r) =>
          r.failed_count > 0
            ? "var(--danger)"
            : r.integrity_disposition === "flag_for_review"
              ? "var(--warn)"
              : undefined
        }
        defaultSort={{ key: "submitted", dir: "desc" }}
        searchKeys={(r) => [r.student_name, r.assignment_title]}
        searchLabel="Search student or assignment"
        pageSize={PAGE}
        minWidth={720}
        empty={
          overriddenOnly
            ? "No submission on this teacher has had its AI score changed."
            : "No work handed in yet."
        }
      />
    </>
  );
}

function fmtScore(n: number | null): string {
  if (n === null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
