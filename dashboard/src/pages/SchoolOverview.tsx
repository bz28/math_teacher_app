import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  type HealthCounts,
  type SchoolOverviewData,
} from "../lib/api";
import StatCard from "../components/StatCard";

// Color palette tracks LLM-call function categories so the same
// function reads consistently across the by-function bar and any
// future per-function drill-down.
const FUNCTION_COLORS: Record<string, string> = {
  vision_extract: "#0ea5e9",
  ai_grading: "#10b981",
  integrity_agent: "#6366f1",
  integrity_answer_equivalence: "#8b5cf6",
};

const DISPOSITION_COLORS: Record<string, string> = {
  pass: "#10b981",
  needs_practice: "#f59e0b",
  tutor_pivot: "#3b82f6",
  flag_for_review: "#ef4444",
  skipped_unreadable: "#64748b",
};

const DISPOSITION_LABELS: Record<string, string> = {
  pass: "Pass",
  needs_practice: "Needs practice",
  tutor_pivot: "Tutor pivot",
  flag_for_review: "Flag for review",
  skipped_unreadable: "Unreadable",
};

function fmtCost(n: number): string {
  if (n >= 1000) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtPercent(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

function colorFor(palette: Record<string, string>, key: string): string {
  return palette[key] ?? "#94a3b8";
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev === 0 && now === 0) {
    return <span className="delta delta-neutral">—</span>;
  }
  const diff = now - prev;
  if (diff === 0) return <span className="delta delta-neutral">flat</span>;
  const sign = diff > 0 ? "↑" : "↓";
  // We deliberately render the magnitude (not the percent) for small
  // counts — going from 1 to 2 active classes is more informative as
  // "+1" than as "+100%".
  return (
    <span className={`delta ${diff > 0 ? "delta-up" : "delta-down"}`}>
      {sign} {Math.abs(diff)}
    </span>
  );
}

function HealthCell({
  label,
  now,
  prev,
}: {
  label: string;
  now: number;
  prev: HealthCounts[keyof HealthCounts];
}) {
  return (
    <StatCard
      label={label}
      value={now}
      sub={
        // StatCard's `sub` is a string; React node would need a
        // bigger refactor. We render the delta inline as text so it
        // stays one component.
        prev === undefined ? undefined : `vs ${prev} last week`
      }
    />
  );
}

function ByFunctionBar({
  rows,
}: {
  rows: SchoolOverviewData["cost"]["by_function"];
}) {
  const total = rows.reduce((acc, r) => acc + r.cost, 0);
  if (total === 0) {
    return <div className="empty-mini">No spend yet this month.</div>;
  }
  return (
    <div>
      <div className="stack-bar">
        {rows.map((r) => {
          const pct = (r.cost / total) * 100;
          if (pct < 0.5) return null;
          return (
            <span
              key={r.function}
              className="stack-bar-seg"
              style={{
                width: `${pct}%`,
                background: colorFor(FUNCTION_COLORS, r.function),
              }}
              title={`${r.function} — ${fmtCost(r.cost)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="stack-bar-legend">
        {rows.map((r) => (
          <div key={r.function} className="legend-item">
            <span
              className="legend-swatch"
              style={{ background: colorFor(FUNCTION_COLORS, r.function) }}
            />
            <span className="legend-label">{r.function}</span>
            <span className="legend-value">{fmtCost(r.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkline({
  points,
}: {
  points: SchoolOverviewData["cost"]["trend_12_weeks"];
}) {
  if (points.length === 0) {
    return <div className="empty-mini">Not enough history yet.</div>;
  }
  const max = Math.max(...points.map((p) => p.cost), 0.0001);
  const w = 280;
  const h = 60;
  const dx = points.length > 1 ? w / (points.length - 1) : 0;
  const path = points
    .map((p, i) => {
      const x = i * dx;
      const y = h - (p.cost / max) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="sparkline">
      <path d={path} fill="none" stroke="#6366f1" strokeWidth={2} />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={i * dx}
          cy={h - (p.cost / max) * h}
          r={2}
          fill="#6366f1"
        >
          <title>
            {p.week_start ?? "?"} — {fmtCost(p.cost)}
          </title>
        </circle>
      ))}
    </svg>
  );
}

function DispositionBar({
  rows,
}: {
  rows: SchoolOverviewData["quality"]["integrity_disposition"];
}) {
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  if (total === 0) {
    return <div className="empty-mini">No integrity checks yet.</div>;
  }
  return (
    <div>
      <div className="stack-bar">
        {rows.map((r) => {
          const pct = (r.count / total) * 100;
          if (pct < 0.5) return null;
          return (
            <span
              key={r.disposition}
              className="stack-bar-seg"
              style={{
                width: `${pct}%`,
                background: colorFor(DISPOSITION_COLORS, r.disposition),
              }}
              title={`${
                DISPOSITION_LABELS[r.disposition] ?? r.disposition
              } — ${r.count} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="stack-bar-legend">
        {rows.map((r) => (
          <div key={r.disposition} className="legend-item">
            <span
              className="legend-swatch"
              style={{ background: colorFor(DISPOSITION_COLORS, r.disposition) }}
            />
            <span className="legend-label">
              {DISPOSITION_LABELS[r.disposition] ?? r.disposition}
            </span>
            <span className="legend-value">{r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SchoolOverview() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SchoolOverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    // Reset on schoolId change so the spinner shows while we refetch
    // — eslint flags the sync setState but this is the right pattern
    // for "swap data when the route param flips".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    api
      .schoolOverview(schoolId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [schoolId]);

  if (error) {
    return (
      <div>
        <h1>School Overview</h1>
        <p style={{ color: "#dc2626" }}>{error}</p>
      </div>
    );
  }
  if (!data) return <p>Loading…</p>;

  const { cost, top_spenders, quality, health, is_internal } = data;
  const monthDelta = cost.this_month - cost.last_month;
  const monthDeltaSign = monthDelta > 0 ? "↑" : monthDelta < 0 ? "↓" : "→";
  const monthDeltaClass =
    monthDelta > 0 ? "delta-up" : monthDelta < 0 ? "delta-down" : "delta-neutral";

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ marginBottom: 4 }}>{data.school_name}</h1>
        <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
          {is_internal
            ? "Founder, test, and non-school user calls — class/teacher tiles are hidden because there's no school context to roll up to."
            : "Per-school cost, quality, and health rollup."}
        </p>
      </div>

      {/* ---------- Cost row ---------- */}
      <h2 className="overview-section">Cost</h2>
      <div className="stat-grid">
        <StatCard
          label="This month"
          value={fmtCost(cost.this_month)}
          sub={
            cost.last_month > 0
              ? `${monthDeltaSign} ${fmtCost(Math.abs(monthDelta))} vs last month`
              : "First month of data"
          }
        />
        <StatCard label="Last month" value={fmtCost(cost.last_month)} />
        <StatCard
          label="Projected month-end"
          value={fmtCost(cost.projected_month_end)}
          sub="Linear projection"
        />
        <StatCard
          label="Cost / submission"
          value={fmtCost(cost.cost_per_submission)}
          sub="School-wide avg, this month"
        />
      </div>

      <div className="overview-card-row">
        <div className="overview-card">
          <div className="overview-card-title">Spend by function (this month)</div>
          <ByFunctionBar rows={cost.by_function} />
        </div>
        <div className="overview-card">
          <div className="overview-card-title">Spend trend (12 weeks)</div>
          <Sparkline points={cost.trend_12_weeks} />
          <div className={`delta ${monthDeltaClass}`} style={{ marginTop: 8 }}>
            {cost.trend_12_weeks.length} weeks of data
          </div>
        </div>
      </div>

      {/* ---------- Top spenders (real schools only) ---------- */}
      {!is_internal && (
        <>
          <h2 className="overview-section">Top spenders</h2>
          <div className="overview-card-row">
            <div className="overview-card">
              <div className="overview-card-title">Top 5 classes (this month)</div>
              {top_spenders.classes.length === 0 ? (
                <div className="empty-mini">No graded submissions yet.</div>
              ) : (
                <table className="mini-table">
                  <tbody>
                    {top_spenders.classes.map((c) => (
                      <tr key={c.section_id}>
                        <td className="mini-table-name">
                          <span style={{ fontWeight: 600 }}>{c.section_name}</span>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>
                            {c.course_name}
                          </div>
                        </td>
                        <td className="mini-table-value">{fmtCost(c.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="overview-card">
              <div className="overview-card-title">Top 5 teachers (this month)</div>
              {top_spenders.teachers.length === 0 ? (
                <div className="empty-mini">No teacher activity yet.</div>
              ) : (
                <table className="mini-table">
                  <tbody>
                    {top_spenders.teachers.map((t) => (
                      <tr key={t.teacher_id}>
                        <td className="mini-table-name">
                          <span style={{ fontWeight: 600 }}>{t.teacher_name}</span>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>
                            {t.teacher_email}
                          </div>
                        </td>
                        <td className="mini-table-value">{fmtCost(t.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="overview-card">
              <div className="overview-card-title">
                Most expensive submissions (this week)
              </div>
              {top_spenders.submissions_this_week.length === 0 ? (
                <div className="empty-mini">No expensive submissions yet.</div>
              ) : (
                <table className="mini-table">
                  <tbody>
                    {top_spenders.submissions_this_week.map((s) => (
                      <tr key={s.submission_id}>
                        <td className="mini-table-name">
                          <Link
                            to={`/school/${schoolId}/llm-calls?submission=${s.submission_id}`}
                            style={{
                              fontWeight: 600,
                              color: "#6366f1",
                              fontFamily: "ui-monospace, monospace",
                            }}
                          >
                            {s.submission_id.slice(0, 8)}
                          </Link>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>
                            {s.call_count} calls
                          </div>
                        </td>
                        <td className="mini-table-value">{fmtCost(s.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {/* ---------- Quality row ---------- */}
      <h2 className="overview-section">Quality</h2>
      <div className="overview-card-row">
        {!is_internal && (
          <div className="overview-card">
            <div className="overview-card-title">Integrity dispositions (lifetime)</div>
            <DispositionBar rows={quality.integrity_disposition} />
          </div>
        )}
        {!is_internal && (
          <div className="overview-card">
            <div className="overview-card-title">AI grade override rate</div>
            <div style={{ fontSize: 32, fontWeight: 800 }}>
              {quality.ai_override_rate === null
                ? "—"
                : fmtPercent(quality.ai_override_rate)}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
              {quality.ai_override_rate === null
                ? "No teacher-reviewed grades yet."
                : "Of teacher-reviewed grades, fraction the teacher changed."}
            </div>
          </div>
        )}
        <div className="overview-card">
          <div className="overview-card-title">Failed LLM calls</div>
          <div style={{ display: "flex", gap: 24 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>
                {quality.failed_calls_24h}
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>last 24h</div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>
                {quality.failed_calls_7d}
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>last 7d</div>
            </div>
          </div>
          {(quality.failed_calls_24h > 0 || quality.failed_calls_7d > 0) && (
            <button
              className="link-btn"
              onClick={() =>
                navigate(`/school/${schoolId}/llm-calls`)
              }
              style={{ marginTop: 8 }}
            >
              View failures →
            </button>
          )}
        </div>
      </div>

      {!is_internal && quality.unreadable_per_teacher.length > 0 && (
        <div className="overview-card" style={{ marginTop: 12 }}>
          <div className="overview-card-title">Unreadable rate per teacher</div>
          <table className="mini-table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th style={{ textAlign: "right" }}>Submissions</th>
                <th style={{ textAlign: "right" }}>Unreadable</th>
                <th style={{ textAlign: "right" }}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {quality.unreadable_per_teacher.map((t) => (
                <tr key={t.teacher_id}>
                  <td>{t.teacher_name}</td>
                  <td style={{ textAlign: "right" }}>{t.total_submissions}</td>
                  <td style={{ textAlign: "right" }}>{t.unreadable_count}</td>
                  <td
                    style={{
                      textAlign: "right",
                      color: t.rate >= 0.1 ? "#dc2626" : "#0f172a",
                      fontWeight: t.rate >= 0.1 ? 700 : 400,
                    }}
                  >
                    {fmtPercent(t.rate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- Health row (real schools only) ---------- */}
      {!is_internal && (
        <>
          <h2 className="overview-section">Health (this week)</h2>
          <div className="stat-grid">
            <HealthCell
              label="Active classes"
              now={health.this_week.active_classes}
              prev={health.last_week.active_classes}
            />
            <HealthCell
              label="Active teachers"
              now={health.this_week.active_teachers}
              prev={health.last_week.active_teachers}
            />
            <HealthCell
              label="Active students"
              now={health.this_week.active_students}
              prev={health.last_week.active_students}
            />
            <HealthCell
              label="HWs published"
              now={health.this_week.hws_published}
              prev={health.last_week.hws_published}
            />
            <HealthCell
              label="Submissions"
              now={health.this_week.submissions}
              prev={health.last_week.submissions}
            />
          </div>
          <div className="overview-card" style={{ marginTop: 12 }}>
            <div className="overview-card-title">Trend vs last week</div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div>
                Classes:{" "}
                <Delta
                  now={health.this_week.active_classes}
                  prev={health.last_week.active_classes}
                />
              </div>
              <div>
                Teachers:{" "}
                <Delta
                  now={health.this_week.active_teachers}
                  prev={health.last_week.active_teachers}
                />
              </div>
              <div>
                Students:{" "}
                <Delta
                  now={health.this_week.active_students}
                  prev={health.last_week.active_students}
                />
              </div>
              <div>
                HWs:{" "}
                <Delta
                  now={health.this_week.hws_published}
                  prev={health.last_week.hws_published}
                />
              </div>
              <div>
                Submissions:{" "}
                <Delta
                  now={health.this_week.submissions}
                  prev={health.last_week.submissions}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
