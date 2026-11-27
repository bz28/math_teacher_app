import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type GradingOverrideCase, type GradingOverridesData } from "../../lib/api";
import DataTable, { type Column } from "../../components/DataTable";
import { EditorialModal } from "../../components/EditorialModal";
import { caseFilePath } from "../../lib/anchor";
import { subjectLabel } from "../../lib/quality";
import { STATUS_LABEL, fmtPts } from "./grading";

/** A small AI-status / teacher-status grade chip for the drill table. */
function GradeChip({ status, percent }: { status: string; percent: number }) {
  const tone = status === "full" ? "var(--ok)" : status === "zero" ? "var(--danger)" : "var(--warn)";
  const soft = status === "full" ? "var(--ok-soft)" : status === "zero" ? "#f3ddd9" : "#f6ecd8";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, background: soft, color: tone,
      padding: "2px 8px", borderRadius: 2, fontSize: 11, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: 0.4, fontFamily: "var(--font-sans)",
    }}>
      {STATUS_LABEL[status] ?? status}
      {status === "partial" && <span className="num" style={{ fontWeight: 500 }}>{Math.round(percent)}%</span>}
    </span>
  );
}

export interface DrillTarget {
  title: string;
  subtitle: string;
  fetches: Record<string, string>[];
}

/** Drill-in modal — fetches the actual overridden cases behind a weak row
 *  or catastrophic cell and lists AI call → teacher final → delta. Accepts
 *  multiple param sets (a severe-flips tile spans two matrix cells). Each
 *  row opens its problem in the submission case file, where the photo,
 *  the read and the grader's reasoning explain the override. */
export default function GradingDrillModal({
  target, baseParams, onClose,
}: {
  target: DrillTarget;
  baseParams: Record<string, string>;
  onClose: () => void;
}) {
  const [data, setData] = useState<GradingOverridesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    Promise.all(
      target.fetches.map((f) => api.gradingQualityOverrides({ ...baseParams, ...f })),
    )
      .then((results) => {
        if (!active) return;
        const cases = results.flatMap((r) => r.cases).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        setData({
          cases,
          total_count: results.reduce((n, r) => n + r.total_count, 0),
          truncated: results.some((r) => r.truncated),
        });
        setError(null);
      })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Failed to load"); });
    return () => { active = false; };
  }, [target, baseParams]);

  const cols: Column<GradingOverrideCase>[] = useMemo(() => [
    {
      key: "where", header: "Course", width: "40%",
      render: (c) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink)" }}>{c.course}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            Problem {c.position} · {subjectLabel(c.subject)}{c.day ? ` · ${c.day}` : ""}
          </div>
        </div>
      ),
    },
    { key: "ai", header: "AI graded", render: (c) => <GradeChip status={c.ai_status} percent={c.ai_percent} /> },
    { key: "final", header: "Teacher final", render: (c) => <GradeChip status={c.final_status} percent={c.final_percent} /> },
    {
      key: "delta", header: "Δ", numeric: true, width: "16%",
      sortValue: (c) => c.delta,
      render: (c) => (
        <span style={{ color: c.delta > 0 ? "var(--accent)" : "var(--info)", fontWeight: 600 }}>
          {fmtPts(c.delta, true)}
        </span>
      ),
    },
  ], []);

  return (
    <EditorialModal eyebrow="Overridden cases" title={target.title} subtitle={target.subtitle} maxWidth={760} onClose={onClose}>
      <div style={{ padding: "18px 30px 30px" }}>
        <DataTable
          columns={cols}
          rows={data?.cases ?? []}
          // One case per graded problem of a submission, so the pair is unique.
          rowKey={(c) => `${c.submission_id}:${c.position}`}
          onRowClick={(c) => navigate(caseFilePath(c.submission_id, c.position))}
          drill
          loading={!data && !error}
          error={error}
          // The caption below counts `data.cases`, and the modal merges
          // several fetches, so a page of 5 under a line reading "Showing
          // 200 of 261" would have the screen contradict itself. This is a
          // scan-the-whole-set drill — it lists what it loaded.
          unpaged
          minWidth={560}
          empty={<span className="dt-state-title">No overridden cases here.</span>}
        />
        {data && data.total_count > 0 && (
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, fontFamily: "var(--font-sans)" }}>
            Showing {Math.min(data.cases.length, data.total_count)} of {data.total_count} overridden problems
            {data.truncated ? " (biggest changes first — narrow the window to see the rest)" : ""}.
            Click a case to open that problem in its case file. Points = the 0–100 per-problem score.
          </p>
        )}
      </div>
    </EditorialModal>
  );
}
