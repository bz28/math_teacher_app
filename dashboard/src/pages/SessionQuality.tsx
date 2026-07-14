import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type QualitySessionDetail } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import MathText from "../components/MathText";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import ErrorState from "../components/ErrorState";
import { MetaChip } from "../components/MetaChip";
import { SUBJECT_LABEL, MODE_LABEL } from "../lib/quality";

const DIM_LABELS: [keyof NonNullable<QualitySessionDetail["score"]>, string][] = [
  ["correctness", "Correctness"],
  ["optimality", "Optimality"],
  ["clarity", "Clarity"],
  ["flow", "Flow"],
];

function dimTone(v: number): "ok" | "warn" | "danger" {
  return v >= 4 ? "ok" : v >= 3 ? "warn" : "danger";
}

export default function SessionQuality() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [data, setData] = useState<QualitySessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    api
      .qualitySession(sessionId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load session."); });
    return () => { cancelled = true; };
  }, [sessionId, reloadKey]);

  if (error) {
    return <ErrorState message={error} onRetry={() => { setError(null); setReloadKey((k) => k + 1); }} />;
  }
  if (!data) return <p className="loading">Loading…</p>;

  const { session, score } = data;

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <Link to="/quality" style={{ fontSize: 13 }}>← Back to Solution quality</Link>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Solution drill-in</span>
          <h1 style={{ fontSize: 26, maxWidth: "38ch" }}>
            <MathText>{session.problem}</MathText>
          </h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
            <MetaChip label={SUBJECT_LABEL[session.subject] ?? session.subject} kind="subject" value={session.subject} />
            <MetaChip label={MODE_LABEL[session.mode] ?? session.mode} kind="mode" value={session.mode} />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {session.problem_type} · {session.total_steps} steps
              {session.created_at && ` · ${formatRelativeDate(session.created_at)}`}
            </span>
          </div>
        </div>
        {score && (
          <StatusPill tone={score.passed ? "ok" : "danger"} label={score.passed ? "PASS" : "FAIL"} />
        )}
      </div>

      {/* ── Judge verdict ───────────────────────────────────────────── */}
      {score ? (
        <>
          <div className="tile-grid">
            {DIM_LABELS.map(([key, label]) => (
              <StatTile
                key={key}
                label={label}
                tone={dimTone(score[key] as number)}
                value={<span>{score[key]}<span style={{ fontSize: 16, color: "var(--muted-2)" }}>/5</span></span>}
              />
            ))}
          </div>
          <div className="table-card">
            <h3>Judge issues</h3>
            {score.issues ? (
              <pre style={{
                whiteSpace: "pre-wrap", fontFamily: "var(--font-sans)", fontSize: 14,
                color: "var(--ink-soft)", lineHeight: 1.55, margin: 0,
              }}>
                {score.issues}
              </pre>
            ) : (
              <p className="empty-mini">No issues flagged — the judge passed this solution on all four dimensions.</p>
            )}
          </div>
        </>
      ) : (
        <div className="table-card">
          <p className="empty-mini">This session hasn't been scored by the quality judge yet.</p>
        </div>
      )}

      {/* ── The exact solution shown to the student ─────────────────── */}
      <div className="table-card">
        <h3>Solution steps shown to the student</h3>
        {session.steps.length === 0 ? (
          <p className="empty-mini">No decomposition steps recorded for this session.</p>
        ) : (
          <ol className="sq-steps">
            {session.steps.map((step, i) => (
              <li key={i} className="sq-step">
                <div className="sq-step-rail">{i + 1}</div>
                <div className="sq-step-body">
                  {step.title && <div className="sq-step-title">{step.title}</div>}
                  <div className="sq-step-desc"><MathText>{step.description}</MathText></div>
                  {step.final_answer && (
                    <div className="sq-step-answer">
                      <span className="sq-step-answer-label">Answer</span>
                      <MathText>{step.final_answer}</MathText>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
