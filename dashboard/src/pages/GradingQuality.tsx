import { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  api,
  type GradingQualityData,
  type GradingBucket,
  type GradingDirection,
} from "../lib/api";
import StatCard from "../components/StatCard";

// Status severity order — best to worst. Drives the override matrix
// (a teacher moving a grade "up" the ranks means the AI under-credited).
const STATUS_ORDER = ["full", "partial", "zero"] as const;
const STATUS_RANK: Record<string, number> = { full: 2, partial: 1, zero: 0 };
const STATUS_LABEL: Record<string, string> = {
  full: "Full",
  partial: "Partial",
  zero: "Zero",
};

// Direction palette: harsh = AI under-credits (burnt sienna, the console's
// alert accent), generous = AI over-credits (cool blue), balanced = moss.
const DIRECTION_META: Record<
  GradingDirection,
  { color: string; soft: string; word: string }
> = {
  too_harsh: { color: "var(--accent)", soft: "var(--accent-soft)", word: "too harsh" },
  too_generous: { color: "var(--info)", soft: "var(--info-soft)", word: "too generous" },
  balanced: { color: "var(--ok)", soft: "var(--ok-soft)", word: "well-calibrated" },
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

/** Signed direction chip — the at-a-glance "which way does the AI lean". */
function DirectionTag({ bucket, size = "sm" }: { bucket: GradingBucket; size?: "sm" | "lg" }) {
  const meta = DIRECTION_META[bucket.direction];
  const big = size === "lg";
  const sign = bucket.mean_delta > 0 ? "+" : "";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        background: meta.soft,
        color: meta.color,
        padding: big ? "5px 12px" : "3px 9px",
        borderRadius: 2,
        fontSize: big ? 12 : 10.5,
        fontWeight: 600,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        fontFamily: "var(--font-sans)",
        whiteSpace: "nowrap",
      }}
    >
      <span className="num" style={{ fontWeight: 500 }}>
        {sign}{bucket.mean_delta.toFixed(1)} pts
      </span>
      {meta.word}
    </span>
  );
}

/** The all-important headline: which way is the AI biased, and how hard. */
function VerdictHero({ summary }: { summary: GradingQualityData["summary"] }) {
  const meta = DIRECTION_META[summary.direction];
  const magnitude = Math.abs(summary.mean_delta).toFixed(1);

  let headline: string;
  let detail: string;
  if (summary.direction === "too_harsh") {
    headline = `The AI grades about ${magnitude}% too harshly.`;
    detail = `Teachers raised the score on ${summary.raised} of the ${summary.overridden_problems} problems they changed — the model under-credits student work.`;
  } else if (summary.direction === "too_generous") {
    headline = `The AI grades about ${magnitude}% too generously.`;
    detail = `Teachers lowered the score on ${summary.lowered} of the ${summary.overridden_problems} problems they changed — the model over-credits student work.`;
  } else {
    headline = "AI grades are well-calibrated.";
    detail = `Across every reviewed problem, teacher overrides net out to ${summary.mean_delta >= 0 ? "+" : ""}${summary.mean_delta.toFixed(1)} points — no systematic bias in either direction.`;
  }

  return (
    <div
      style={{
        borderLeft: `3px solid ${meta.color}`,
        background: "linear-gradient(90deg, var(--paper-2) 0%, transparent 70%)",
        padding: "22px 26px",
        marginBottom: 32,
      }}
    >
      <span className="eyebrow" style={{ marginBottom: 8 }}>Direction signal</span>
      <h2 style={{ fontSize: 34, marginBottom: 10, maxWidth: "22ch" }}>{headline}</h2>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--muted)", maxWidth: "62ch", fontStyle: "normal", lineHeight: 1.5 }}>
        {detail}{" "}Based on{" "}
        <strong style={{ color: "var(--ink-soft)" }}>{summary.overridden_problems}</strong>{" "}
        overridden of{" "}
        <strong style={{ color: "var(--ink-soft)" }}>{summary.graded_problems}</strong>{" "}
        AI-graded problems across{" "}
        <strong style={{ color: "var(--ink-soft)" }}>{summary.reviewed_submissions}</strong>{" "}
        reviewed submissions.
      </p>
    </div>
  );
}

/** AI's call (rows, full→zero top to bottom) → teacher's final call
 *  (columns, full→zero left to right). The top-right triangle is where
 *  teachers LOWERED grades (AI too generous); the bottom-left is where
 *  they RAISED them (AI too harsh). The diagonal is agreement. */
function StatusMatrix({ cells }: { cells: GradingQualityData["status_matrix"] }) {
  const lookup = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of cells) m[`${c.from}->${c.to}`] = c.count;
    return m;
  }, [cells]);

  const maxChange = useMemo(
    () => Math.max(1, ...cells.filter((c) => c.is_change).map((c) => c.count)),
    [cells],
  );

  function cellStyle(from: string, to: string, count: number): React.CSSProperties {
    const fromR = STATUS_RANK[from];
    const toR = STATUS_RANK[to];
    if (fromR === toR) {
      // Agreement — neutral, recedes.
      return { background: "var(--surface)", color: count ? "var(--muted)" : "var(--muted-2)" };
    }
    const raised = toR > fromR;
    const base = raised ? "184, 67, 26" : "61, 90, 120"; // accent vs info, rgb
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
        {/* Header row */}
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
        {/* Body rows */}
        {STATUS_ORDER.map((from) => (
          <Row key={from}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 12 }}>
              <span className="stat-label" style={{ marginBottom: 0 }}>
                {from === "full" ? "AI: " : ""}{STATUS_LABEL[from]}
              </span>
            </div>
            {STATUS_ORDER.map((to) => {
              const count = lookup[`${from}->${to}`] ?? 0;
              return (
                <div
                  key={to}
                  style={{
                    height: 64,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-mono)",
                    fontSize: 18,
                    ...cellStyle(from, to, count),
                  }}
                  title={`AI ${STATUS_LABEL[from]} → Teacher ${STATUS_LABEL[to]}: ${count}`}
                >
                  {count}
                </div>
              );
            })}
          </Row>
        ))}
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 14 }}>
        <Legend color="var(--accent)" label="Teacher raised (AI too harsh)" />
        <Legend color="var(--info)" label="Teacher lowered (AI too generous)" />
        <Legend color="var(--rule-strong)" label="Agreement" />
      </div>
    </div>
  );
}

// `display: contents` so the row's cells participate directly in the
// parent grid (keeps the 4-column layout without nested grids).
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "contents" }}>{children}</div>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--muted)" }}>
      <span style={{ width: 9, height: 9, background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

/** Weak-spot rows: each subject/course with its override rate as a bar,
 *  sorted worst-first by the backend. The whole point of the report —
 *  "where is grading weakest" — should read top-to-bottom. */
function WeakSpots({
  rows,
}: {
  rows: { key: string; name: string; meta?: string; bucket: GradingBucket }[];
}) {
  const maxRate = Math.max(1, ...rows.map((r) => r.bucket.override_rate));
  return (
    <div className="list" style={{ borderTop: "1px solid var(--rule)" }}>
      {rows.map((r) => {
        const meta = DIRECTION_META[r.bucket.direction];
        return (
          <div
            key={r.key}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(140px, 1.4fr) 2fr auto auto",
              gap: 20,
              alignItems: "center",
              padding: "16px 0",
              borderBottom: "1px solid var(--rule)",
            }}
          >
            <div>
              <div className="list-row-primary" style={{ fontSize: 17 }}>{r.name}</div>
              {r.meta && <div className="list-row-secondary">{r.meta}</div>}
            </div>
            <div>
              <div style={{ height: 8, background: "var(--paper-2)", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${(r.bucket.override_rate / maxRate) * 100}%`,
                    height: "100%",
                    background: meta.color,
                    minWidth: r.bucket.override_rate > 0 ? 2 : 0,
                  }}
                />
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>
                {r.bucket.overridden_problems} of {r.bucket.graded_problems} problems overridden
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="num" style={{ fontSize: 20, color: "var(--ink)" }}>
                {r.bucket.override_rate.toFixed(1)}%
              </div>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1.2 }}>
                override rate
              </div>
            </div>
            <div style={{ minWidth: 150, textAlign: "right" }}>
              <DirectionTag bucket={r.bucket} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function GradingQuality() {
  const [data, setData] = useState<GradingQualityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState("2160");
  const [subject, setSubject] = useState("");

  useEffect(() => {
    let active = true;
    api
      .gradingQuality({ hours, subject })
      .then((d) => {
        if (!active) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => { active = false; };
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
          <VerdictHero summary={summary} />

          <div className="stat-grid">
            <StatCard
              label="Override rate"
              value={`${summary.override_rate.toFixed(1)}%`}
              sub={`${summary.overridden_problems} of ${summary.graded_problems} problems`}
            />
            <StatCard
              label="Direction"
              value={
                <span style={{ color: DIRECTION_META[summary.direction].color }}>
                  {summary.mean_delta >= 0 ? "+" : ""}{summary.mean_delta.toFixed(1)}
                </span>
              }
              sub={`avg pts — ${DIRECTION_META[summary.direction].word}`}
            />
            <StatCard
              label="Avg change size"
              value={`${summary.mean_override_magnitude.toFixed(1)}`}
              sub="pts when teacher intervenes"
            />
            <StatCard
              label="Raised vs lowered"
              value={
                <span>
                  <span style={{ color: "var(--accent)" }}>{summary.raised}</span>
                  <span style={{ color: "var(--muted-2)" }}> / </span>
                  <span style={{ color: "var(--info)" }}>{summary.lowered}</span>
                </span>
              }
              sub="overrides up / down"
            />
          </div>

          <div className="table-card">
            <h3>Status changes — AI's call vs teacher's final</h3>
            <div style={{ overflowX: "auto", paddingTop: 4 }}>
              <StatusMatrix cells={data.status_matrix} />
            </div>
          </div>

          <div className="table-card">
            <h3>Weakest by subject</h3>
            {data.by_subject.length > 0 ? (
              <WeakSpots
                rows={data.by_subject.map((s) => ({
                  key: s.subject,
                  name: subjectLabel(s.subject),
                  bucket: s,
                }))}
              />
            ) : (
              <p className="empty-mini">No subject breakdown available.</p>
            )}
          </div>

          {data.by_course.length > 0 && (
            <div className="table-card">
              <h3>Weakest by course</h3>
              <WeakSpots
                rows={data.by_course.slice(0, 12).map((c) => ({
                  key: `${c.course}-${c.subject}`,
                  name: c.course,
                  meta: subjectLabel(c.subject),
                  bucket: c,
                }))}
              />
            </div>
          )}

          {data.trend.length > 1 && (
            <div className="chart-card">
              <h3>Override rate over time</h3>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.trend}>
                  <CartesianGrid strokeDasharray="2 4" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis unit="%" domain={[0, 100]} />
                  <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                  <Area
                    type="monotone"
                    dataKey="override_rate"
                    stroke="#b8431a"
                    fill="#b8431a1a"
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="page-header">
      <span className="eyebrow">Diagnostic</span>
      <h1>Grading quality</h1>
      <p>Where teachers override the AI's grades — the signal for where grading is weak.</p>
    </div>
  );
}
