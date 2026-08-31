import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import {
  api,
  type GradingQualityData,
  type GradingSummary,
  type GradingBucket,
  type GradingDirection,
  type GradingOverridesData,
} from "../lib/api";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import { EditorialModal } from "../components/EditorialModal";

// Status severity order — best to worst. Drives the override matrix
// (a teacher moving a grade "up" the ranks means the AI under-credited).
const STATUS_ORDER = ["full", "partial", "zero"] as const;
const STATUS_RANK: Record<string, number> = { full: 2, partial: 1, zero: 0 };
const STATUS_LABEL: Record<string, string> = {
  full: "Full",
  partial: "Partial",
  zero: "Zero",
};

// Below this many compared problems the override rate is too thin to
// trust — the page surfaces a caveat and de-emphasizes the row.
const THIN_SAMPLE = 30;

// Direction palette: harsh = AI under-credits (burnt sienna, the console's
// alert accent), generous = AI over-credits (cool blue), balanced = moss.
const DIRECTION_META: Record<
  GradingDirection,
  { color: string; soft: string; word: string }
> = {
  too_harsh: { color: "var(--accent)", soft: "var(--accent-soft)", word: "too harsh" },
  too_generous: { color: "var(--info)", soft: "var(--info-soft)", word: "too generous" },
  balanced: { color: "var(--ok)", soft: "var(--ok-soft)", word: "well-calibrated" },
  // No overrides at all. Deliberately NOT a verdict — see VerdictHero.
  unmeasured: { color: "var(--muted)", soft: "var(--paper-2)", word: "not yet measured" },
};

const SUBJECT_LABEL: Record<string, string> = {
  math: "Math",
  chemistry: "Chemistry",
  physics: "Physics",
  unknown: "Unspecified",
};

function subjectLabel(s: string): string {
  return SUBJECT_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

// Delta unit is percentage-POINTS on the 0–100 per-problem score — the
// SAME scale everywhere (hero, tiles, rows, drill). Never rendered as a
// bare "%", which reads as a relative change.
function fmtPts(v: number, signed = false): string {
  const sign = signed && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)} pts`;
}

/** Severe flips — full↔zero reversals, the worst grading errors. Pulled
 *  from the status matrix (both directions). */
function severeFlips(matrix: GradingQualityData["status_matrix"]): number {
  return matrix
    .filter((c) => (c.from === "full" && c.to === "zero") || (c.from === "zero" && c.to === "full"))
    .reduce((n, c) => n + c.count, 0);
}

/** Signed direction chip — the at-a-glance "which way does the AI lean". */
function DirectionTag({ bucket }: { bucket: GradingBucket }) {
  const meta = DIRECTION_META[bucket.direction];
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        background: meta.soft, color: meta.color, padding: "3px 9px",
        borderRadius: 2, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5,
        textTransform: "uppercase", fontFamily: "var(--font-sans)", whiteSpace: "nowrap",
      }}
    >
      <span className="num" style={{ fontWeight: 500 }}>{fmtPts(bucket.mean_delta, true)}</span>
      {meta.word}
    </span>
  );
}

/** The all-important headline: which way is the AI biased, and how hard.
 *  Units are percentage-points — consistent with every tile below. */
function VerdictHero({ summary }: { summary: GradingSummary }) {
  const meta = DIRECTION_META[summary.direction];
  const magnitude = Math.abs(summary.mean_delta).toFixed(1);

  let headline: string;
  let detail: string;
  if (summary.direction === "unmeasured") {
    // This branch replaces a real defect: the page used to announce "AI
    // grades are well-calibrated" here, because zero overrides makes the
    // mean delta trivially 0.0 and the old code read that as balanced.
    // It was a confident verdict from an empty set. Nobody having
    // corrected the AI is not evidence that the AI is right — it is
    // evidence that nobody has checked.
    headline = "Nobody has overridden a grade yet.";
    detail = `Teachers reviewed ${summary.reviewed_submissions} submission${summary.reviewed_submissions === 1 ? "" : "s"} without changing a single mark. That is not the same as the AI being right — until someone disagrees, there is nothing to measure calibration against.`;
  } else if (summary.direction === "too_harsh") {
    headline = `The AI grades about ${magnitude} points too harsh.`;
    detail = `Teachers raised the score on ${summary.raised} of the ${summary.overridden_problems} problems they changed — the model under-credits student work.`;
  } else if (summary.direction === "too_generous") {
    headline = `The AI grades about ${magnitude} points too generous.`;
    detail = `Teachers lowered the score on ${summary.lowered} of the ${summary.overridden_problems} problems they changed — the model over-credits student work.`;
  } else {
    headline = "AI grades are well-calibrated.";
    detail = `Across every reviewed problem, teacher overrides net out to ${fmtPts(summary.mean_delta, true)} — no systematic bias in either direction.`;
  }

  return (
    <div
      style={{
        borderLeft: `3px solid ${meta.color}`,
        background: "linear-gradient(90deg, var(--paper-2) 0%, transparent 70%)",
        padding: "22px 26px", marginBottom: 20,
      }}
    >
      <span className="eyebrow" style={{ marginBottom: 8 }}>Trust verdict</span>
      <h2 style={{ fontSize: 34, marginBottom: 10, maxWidth: "24ch" }}>{headline}</h2>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--muted)", maxWidth: "64ch", fontStyle: "normal", lineHeight: 1.5 }}>
        {detail}{" "}Based on{" "}
        <strong style={{ color: "var(--ink-soft)" }}>{summary.overridden_problems}</strong>{" "}
        overridden of{" "}
        <strong style={{ color: "var(--ink-soft)" }}>{summary.graded_problems}</strong>{" "}
        graded problems across{" "}
        <strong style={{ color: "var(--ink-soft)" }}>{summary.reviewed_submissions}</strong>{" "}
        reviewed submissions. Points = the 0–100 per-problem score.
      </p>
    </div>
  );
}

/** Thin-coverage caveat — the override rate rests on too few problems, or
 *  teachers have reviewed too small a slice of what the AI graded. */
function ThinCaveat({ summary }: { summary: GradingSummary }) {
  const thinSample = summary.graded_problems > 0 && summary.graded_problems < THIN_SAMPLE;
  const coverage = summary.ai_graded_submissions > 0
    ? summary.reviewed_ai_grades / summary.ai_graded_submissions
    : null;
  const thinCoverage = coverage !== null && coverage < 0.5 && summary.ai_graded_submissions >= 5;
  if (!thinSample && !thinCoverage) return null;

  const parts: string[] = [];
  if (thinSample) {
    parts.push(`only ${summary.graded_problems} problems have been reviewed in this window`);
  }
  if (thinCoverage) {
    parts.push(`teachers have reviewed just ${Math.round(coverage! * 100)}% of the ${summary.ai_graded_submissions} grades the AI produced`);
  }
  if (summary.unalignable_submissions > 0) {
    // Previously dropped in silence, which let the page report "across 19
    // reviewed submissions" beside a coverage tile saying 281 — the same
    // screen, 15x apart, unexplained. A report that discards records has
    // to say so, or its denominator is a lie of omission.
    parts.push(`${summary.unalignable_submissions} reviewed submission${summary.unalignable_submissions === 1 ? "" : "s"} could not be compared at all (the AI and teacher grade lists don't line up) and ${summary.unalignable_submissions === 1 ? "is" : "are"} excluded entirely`);
  }
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        background: "var(--warn-soft, #f6ecd8)", borderLeft: "3px solid var(--warn)",
        padding: "12px 16px", marginBottom: 24, fontSize: 13, color: "var(--ink-soft)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <StatusPill tone="warn" label="THIN" />
      <span>
        Read this as a signal, not a verdict — {parts.join(", and ")}. Widen the window or wait for more reviews before trusting the direction.
      </span>
    </div>
  );
}

/** Dual-series trend — override rate (left axis) and mean delta / direction
 *  (right axis) over time, so drift in either reads at a glance. */
function TrendChart({ trend }: { trend: GradingQualityData["trend"] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="2 4" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="rate" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} width={44} />
        <YAxis
          yAxisId="delta" orientation="right" tick={{ fontSize: 11 }} width={44}
          tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`}
        />
        <Tooltip
          formatter={(v, name) =>
            name === "Override rate"
              ? [`${Number(v).toFixed(1)}%`, name]
              : [fmtPts(Number(v), true), "Direction (mean Δ)"]
          }
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine yAxisId="delta" y={0} stroke="var(--rule-strong)" strokeDasharray="3 3" />
        <Line
          yAxisId="rate" type="monotone" dataKey="override_rate" name="Override rate"
          stroke="#b8431a" strokeWidth={1.75} dot={false}
        />
        <Line
          yAxisId="delta" type="monotone" dataKey="mean_delta" name="Direction (mean Δ)"
          stroke="#14130f" strokeWidth={1.5} strokeDasharray="5 3" dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

interface WeakRow {
  key: string;
  name: string;
  meta?: string;
  bucket: GradingBucket;
  drill: Record<string, string>;
}

/** Weak-spot table — volume-aware (graded_problems shown, low-n rows
 *  de-emphasized), override magnitude + raised/lowered per row, and each
 *  row drills into the actual overridden cases. */
function WeakSpotsTable({
  rows, onDrill,
}: {
  rows: WeakRow[];
  onDrill: (row: WeakRow) => void;
}) {
  const maxRate = Math.max(1, ...rows.map((r) => r.bucket.override_rate));
  const isThin = (r: WeakRow) => r.bucket.graded_problems < THIN_SAMPLE;

  const cols: Column<WeakRow>[] = [
    {
      key: "name", header: "Subject / course", width: "26%",
      render: (r) => (
        <div style={{ minWidth: 0, opacity: isThin(r) ? 0.55 : 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--ink)", fontWeight: 500 }}>{r.name}</span>
            {isThin(r) && <StatusPill tone="neutral" label="THIN" />}
          </div>
          {r.meta && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.meta}</div>}
        </div>
      ),
    },
    {
      key: "override", header: "Override rate", width: "30%",
      sortValue: (r) => r.bucket.override_rate,
      render: (r) => (
        <div style={{ opacity: isThin(r) ? 0.55 : 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="num" style={{ fontSize: 16, color: "var(--ink)" }}>
              {r.bucket.override_rate.toFixed(1)}%
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {r.bucket.overridden_problems} of {r.bucket.graded_problems}
            </span>
          </div>
          <div style={{ height: 6, background: "var(--paper-2)", overflow: "hidden", marginTop: 4 }}>
            <div style={{
              width: `${(r.bucket.override_rate / maxRate) * 100}%`, height: "100%",
              background: DIRECTION_META[r.bucket.direction].color,
              minWidth: r.bucket.override_rate > 0 ? 2 : 0,
            }} />
          </div>
        </div>
      ),
    },
    {
      key: "graded", header: "Graded", numeric: true, width: "12%",
      sortValue: (r) => r.bucket.graded_problems,
      render: (r) => <span style={{ color: "var(--ink-soft)" }}>{r.bucket.graded_problems}</span>,
    },
    {
      key: "magnitude", header: "Avg Δ size", numeric: true, width: "12%",
      sortValue: (r) => r.bucket.mean_override_magnitude,
      render: (r) => <span style={{ color: "var(--ink-soft)" }}>{r.bucket.mean_override_magnitude.toFixed(1)}</span>,
    },
    {
      key: "split", header: "Raised / lowered", align: "right", width: "20%",
      render: (r) => (
        <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span className="num" style={{ fontSize: 13 }}>
            <span style={{ color: "var(--accent)" }}>↑{r.bucket.raised}</span>
            <span style={{ color: "var(--muted-2)" }}> / </span>
            <span style={{ color: "var(--info)" }}>↓{r.bucket.lowered}</span>
          </span>
          <DirectionTag bucket={r.bucket} />
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={cols}
      rows={rows}
      rowKey={(r) => r.key}
      onRowClick={onDrill}
      drill
      defaultSort={{ key: "override", dir: "desc" }}
      minWidth={720}
      empty={<span className="dt-state-title">No breakdown available.</span>}
    />
  );
}

/** AI's call (rows, full→zero top to bottom) → teacher's final call
 *  (columns). Top-right = teachers LOWERED (AI too generous); bottom-left
 *  = they RAISED (AI too harsh). Catastrophic full↔zero cells drill in. */
function StatusMatrix({
  cells, onCatastrophic,
}: {
  cells: GradingQualityData["status_matrix"];
  onCatastrophic: (from: string, to: string) => void;
}) {
  const lookup = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of cells) m[`${c.from}->${c.to}`] = c.count;
    return m;
  }, [cells]);

  const maxChange = useMemo(
    () => Math.max(1, ...cells.filter((c) => c.is_change).map((c) => c.count)),
    [cells],
  );

  const isCatastrophic = (from: string, to: string) => Math.abs(STATUS_RANK[from] - STATUS_RANK[to]) === 2;

  function cellStyle(from: string, to: string, count: number): React.CSSProperties {
    const fromR = STATUS_RANK[from];
    const toR = STATUS_RANK[to];
    if (fromR === toR) {
      return { background: "var(--surface)", color: count ? "var(--muted)" : "var(--muted-2)" };
    }
    const raised = toR > fromR;
    const base = raised ? "184, 67, 26" : "61, 90, 120";
    const intensity = count ? 0.12 + 0.5 * (count / maxChange) : 0.04;
    return {
      background: `rgba(${base}, ${intensity})`,
      color: count ? (raised ? "var(--accent)" : "var(--info)") : "var(--muted-2)",
      fontWeight: count ? 600 : 400,
    };
  }

  return (
    <div style={{ display: "inline-block", minWidth: 360 }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto repeat(3, 84px)", gap: 1 }}>
        <div />
        <div style={{ gridColumn: "2 / span 3", textAlign: "center", paddingBottom: 6 }}>
          <span className="stat-label" style={{ marginBottom: 0 }}>Teacher's final call →</span>
        </div>
        <div />
        {STATUS_ORDER.map((to) => (
          <div key={to} style={{ textAlign: "center", paddingBottom: 6 }}>
            <span className="stat-label" style={{ marginBottom: 0 }}>{STATUS_LABEL[to]}</span>
          </div>
        ))}
        {STATUS_ORDER.map((from) => (
          <Row key={from}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 12 }}>
              <span className="stat-label" style={{ marginBottom: 0 }}>
                {from === "full" ? "AI: " : ""}{STATUS_LABEL[from]}
              </span>
            </div>
            {STATUS_ORDER.map((to) => {
              const count = lookup[`${from}->${to}`] ?? 0;
              const cat = isCatastrophic(from, to) && count > 0;
              return (
                <div
                  key={to}
                  role={cat ? "button" : undefined}
                  tabIndex={cat ? 0 : undefined}
                  onClick={cat ? () => onCatastrophic(from, to) : undefined}
                  onKeyDown={cat ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCatastrophic(from, to); } } : undefined}
                  style={{
                    position: "relative",
                    height: 64, display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "var(--font-mono)", fontSize: 18,
                    cursor: cat ? "pointer" : "default",
                    outline: cat ? "1px solid rgba(138, 35, 23, 0.35)" : undefined,
                    ...cellStyle(from, to, count),
                  }}
                  title={
                    cat
                      ? `AI ${STATUS_LABEL[from]} → Teacher ${STATUS_LABEL[to]}: ${count} — click to see the cases`
                      : `AI ${STATUS_LABEL[from]} → Teacher ${STATUS_LABEL[to]}: ${count}`
                  }
                >
                  {count}
                  {cat && (
                    <span aria-hidden="true" style={{ position: "absolute", top: 3, right: 5, fontSize: 10, color: "var(--danger)" }}>⤢</span>
                  )}
                </div>
              );
            })}
          </Row>
        ))}
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 14, flexWrap: "wrap" }}>
        <Legend2 color="var(--accent)" label="Teacher raised (AI too harsh)" />
        <Legend2 color="var(--info)" label="Teacher lowered (AI too generous)" />
        <Legend2 color="var(--rule-strong)" label="Agreement" />
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>⤢ full↔zero flip — click to inspect</span>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "contents" }}>{children}</div>;
}

function Legend2({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--muted)" }}>
      <span style={{ width: 9, height: 9, background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

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

interface DrillTarget {
  title: string;
  subtitle: string;
  fetches: Record<string, string>[];
}

/** Drill-in modal — fetches the actual overridden cases behind a weak row
 *  or catastrophic cell and lists AI call → teacher final → delta. Accepts
 *  multiple param sets (a severe-flips tile spans two matrix cells). */
function DrillModal({
  target, baseParams, onClose,
}: {
  target: DrillTarget;
  baseParams: Record<string, string>;
  onClose: () => void;
}) {
  const [data, setData] = useState<GradingOverridesData | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Stable per-render keys (cases carry no id and can repeat identically).
  const keyed = useMemo(
    () => (data?.cases ?? []).map((c, i) => ({ ...c, _k: String(i) })),
    [data],
  );
  type Keyed = GradingOverridesData["cases"][number] & { _k: string };

  const cols: Column<Keyed>[] = [
    {
      key: "where", header: "Course", width: "34%",
      render: (c) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink)" }}>{c.course}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {subjectLabel(c.subject)}{c.day ? ` · ${c.day}` : ""}
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
  ];

  return (
    <EditorialModal eyebrow="Overridden cases" title={target.title} subtitle={target.subtitle} maxWidth={760} onClose={onClose}>
      <div style={{ padding: "18px 30px 30px" }}>
        <DataTable
          columns={cols}
          rows={keyed}
          rowKey={(r) => r._k}
          loading={!data && !error}
          error={error}
          minWidth={560}
          empty={<span className="dt-state-title">No overridden cases here.</span>}
        />
        {data && data.total_count > 0 && (
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, fontFamily: "var(--font-sans)" }}>
            Showing {Math.min(data.cases.length, data.total_count)} of {data.total_count} overridden problems
            {data.truncated ? " (biggest changes first — narrow the window to see the rest)" : ""}. Points = the 0–100 per-problem score.
          </p>
        )}
      </div>
    </EditorialModal>
  );
}

export default function GradingQuality() {
  const [data, setData] = useState<GradingQualityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState("2160");
  const [subject, setSubject] = useState("");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  useEffect(() => {
    let active = true;
    api
      .gradingQuality({ hours, subject })
      .then((d) => { if (!active) return; setData(d); setError(null); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Failed to load"); });
    return () => { active = false; };
  }, [hours, subject]);

  // Base params every drill inherits — the active window + subject filter.
  const baseParams = useMemo(() => {
    const p: Record<string, string> = { hours };
    if (subject) p.subject = subject;
    return p;
  }, [hours, subject]);

  if (error) {
    return (
      <div>
        <Header />
        <div className="empty-state">
          <div className="empty-state-title">Couldn't load grading quality</div>
          <div className="empty-state-sub">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return <p className="loading">Loading…</p>;

  const { summary } = data;
  const hasData = summary.reviewed_submissions > 0 && summary.graded_problems > 0;
  const flips = severeFlips(data.status_matrix);
  const coveragePct = summary.ai_graded_submissions > 0
    ? (summary.reviewed_ai_grades / summary.ai_graded_submissions) * 100
    : null;

  const subjectRows: WeakRow[] = data.by_subject.map((s) => ({
    key: `subj-${s.subject}`,
    name: subjectLabel(s.subject),
    bucket: s,
    drill: { subject: s.subject },
  }));
  const courseRows: WeakRow[] = data.by_course.slice(0, 15).map((c) => ({
    key: `course-${c.course}-${c.subject}`,
    name: c.course,
    meta: subjectLabel(c.subject),
    bucket: c,
    drill: { course: c.course, subject: c.subject },
  }));

  const openWeakDrill = (row: WeakRow) => setDrill({
    title: row.name,
    subtitle: `Every problem a teacher overrode in ${row.name}${row.meta ? ` (${row.meta})` : ""}, biggest change first.`,
    fetches: [row.drill],
  });

  return (
    <div>
      <Header />

      <div className="filters">
        <select value={hours} onChange={(e) => setHours(e.target.value)}>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
          <option value="2160">Last 90 days</option>
          <option value="87600">All time</option>
        </select>
        <select value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">All subjects</option>
          {data.subjects.map((s) => (
            <option key={s} value={s}>{subjectLabel(s)}</option>
          ))}
        </select>
        {subject && (
          <button className="filter-badge" onClick={() => setSubject("")} style={{ cursor: "pointer", border: "none" }}>
            {subjectLabel(subject)} ✕
          </button>
        )}
      </div>

      {!hasData ? (
        <div className="empty-state">
          <div className="empty-state-title">No reviewed grades yet</div>
          <div className="empty-state-sub">
            Once teachers review or publish AI-graded submissions in this window,
            their overrides will surface here.
          </div>
        </div>
      ) : (
        <>
          {/* ── Band 1 — Verdict ─────────────────────────────────────── */}
          <VerdictHero summary={summary} />
          <ThinCaveat summary={summary} />

          <div className="tile-grid">
            <StatTile
              label="Override rate"
              value={`${summary.override_rate.toFixed(1)}%`}
              sub={
                <span>
                  <span style={{ color: "var(--accent)" }}>↑{summary.raised} raised</span>
                  {" / "}
                  <span style={{ color: "var(--info)" }}>↓{summary.lowered} lowered</span>
                </span>
              }
            />
            <StatTile
              label="Review coverage"
              tone={coveragePct !== null && coveragePct < 50 && summary.ai_graded_submissions >= 5 ? "warn" : "default"}
              value={coveragePct === null ? "—" : `${Math.round(coveragePct)}%`}
              sub={
                summary.ai_graded_submissions > 0
                  ? `${summary.reviewed_ai_grades} of ${summary.ai_graded_submissions} AI grades reviewed`
                  : "no AI grades this window"
              }
            />
            <StatTile
              label="Avg change size"
              value={fmtPts(summary.mean_override_magnitude)}
              sub="when a teacher intervenes"
            />
            <StatTile
              label="Severe flips"
              tone={flips > 0 ? "danger" : "default"}
              value={flips}
              sub={flips > 0 ? "full↔zero — click to inspect" : "full↔zero reversals"}
              onClick={flips > 0 ? () => setDrill({
                title: "Severe flips",
                subtitle: "Full↔zero reversals — the AI and teacher landed at opposite extremes.",
                fetches: [
                  { from_status: "full", to_status: "zero" },
                  { from_status: "zero", to_status: "full" },
                ],
              }) : undefined}
            />
          </div>

          {/* ── Band 2 — Trend (promoted) ────────────────────────────── */}
          {data.trend.length > 1 && (
            <div className="chart-card">
              <h3>Override rate &amp; direction over time</h3>
              <TrendChart trend={data.trend} />
            </div>
          )}

          {/* ── Band 3 — Weak spots (above the matrix) ───────────────── */}
          <div className="table-card">
            {/* "Weakest" is a ranking claim, and it needs something to
                rank. Over one subject it is a superlative against
                nothing — and the course table below repeated the same
                row verbatim. Only promise an ordering when there is one. */}
            <h3>
              {subjectRows.length > 1
                ? "Weakest by subject — click a row for the cases"
                : "By subject — click a row for the cases"}
            </h3>
            <WeakSpotsTable rows={subjectRows} onDrill={openWeakDrill} />
          </div>

          {courseRows.length > 0 && (
            <div className="table-card">
              <h3>
                {courseRows.length > 1
                  ? "Weakest by course — click a row for the cases"
                  : "By course — click a row for the cases"}
              </h3>
              <WeakSpotsTable rows={courseRows} onDrill={openWeakDrill} />
            </div>
          )}

          {/* ── Band 4 — Status matrix (secondary) ───────────────────── */}
          <div className="table-card">
            <h3>Status changes — AI's call vs teacher's final</h3>
            <div style={{ overflowX: "auto", paddingTop: 4 }}>
              <StatusMatrix
                cells={data.status_matrix}
                onCatastrophic={(from, to) => setDrill({
                  title: `${STATUS_LABEL[from]} → ${STATUS_LABEL[to]}`,
                  subtitle: `Problems the AI graded ${STATUS_LABEL[from].toLowerCase()} that the teacher moved to ${STATUS_LABEL[to].toLowerCase()}.`,
                  fetches: [{ from_status: from, to_status: to }],
                })}
              />
            </div>
          </div>
        </>
      )}

      {drill && <DrillModal target={drill} baseParams={baseParams} onClose={() => setDrill(null)} />}
    </div>
  );
}

function Header() {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <span className="eyebrow">Diagnostic</span>
        <h1>Grading quality</h1>
        <p>Is the AI grader trustworthy — how often teachers override it, by how much, and where it goes wrong.</p>
      </div>
      <StatusPill tone="info" label="OVERRIDE SIGNAL" title="Teacher overrides are the ground-truth signal for grading accuracy" />
    </div>
  );
}
