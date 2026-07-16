import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type LLMCallsData, type SubmissionSummary } from "../lib/api";
import {
  fmtCost,
  fmtRelativeMs,
  fmtWallTime,
  formatRelativeDate,
  shortId,
  shortModel,
} from "../lib/format";
import { PIPELINE_BUCKETS, bucketFor } from "../lib/llm_modes";
import MetadataChips from "../components/MetadataChips";
import StatusPill, { type PillTone } from "../components/StatusPill";
import { useConfirm } from "../lib/confirm";

// SubmissionTrace — the per-submission case file. Traces ONE student
// submission end-to-end (extraction → grading → integrity) so an
// operator can debug a specific case. The page identity is the student
// and the DECISIONS this run produced (AI grade, integrity verdict,
// teacher action) — not the raw UUID. Below the header, every logged
// LLM call is grouped by pipeline stage into a chronological timeline;
// failed calls open expanded with the error visible, and every row
// carries inline debug + session actions.

type PillMeta = { tone: PillTone; label: string };

const INTEGRITY_DISPOSITION: Record<string, PillMeta> = {
  pass: { tone: "ok", label: "PASS" },
  needs_practice: { tone: "warn", label: "NEEDS PRACTICE" },
  tutor_pivot: { tone: "warn", label: "TUTOR PIVOT" },
  flag_for_review: { tone: "danger", label: "FLAG FOR REVIEW" },
};

// The integrity verdict pill: the agent's disposition when it finished,
// else a lifecycle-derived state (unreadable / in progress / no check).
function integrityPill(s: SubmissionSummary): PillMeta {
  if (s.integrity_disposition && INTEGRITY_DISPOSITION[s.integrity_disposition]) {
    return INTEGRITY_DISPOSITION[s.integrity_disposition];
  }
  switch (s.integrity_status) {
    case "skipped_unreadable":
      return { tone: "neutral", label: "UNREADABLE" };
    case "extracting":
    case "in_progress":
    case "awaiting_student":
      return { tone: "info", label: "IN PROGRESS" };
    case null:
    case undefined:
      return { tone: "neutral", label: "NO CHECK" };
    default:
      return { tone: "neutral", label: s.integrity_status.replace(/_/g, " ").toUpperCase() };
  }
}

// Teacher action = the human layer on top of the AI grade. Nothing
// auto-posts — a grade is a draft until the teacher reviews and
// publishes it to the student.
function teacherAction(s: SubmissionSummary): { label: string; sub: string } {
  if (s.grade_published_at) {
    return { label: "Published to student", sub: `published ${formatRelativeDate(s.grade_published_at)}` };
  }
  if (s.reviewed_at) {
    return { label: "Reviewed by teacher", sub: `reviewed ${formatRelativeDate(s.reviewed_at)}` };
  }
  if (s.final_score != null || s.graded_at) {
    return { label: "Awaiting teacher review", sub: "AI grade drafted — not yet approved" };
  }
  return { label: "Not graded", sub: "no grade on record" };
}

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n)}%`;
}

const ASSIGNMENT_TYPE_LABEL: Record<string, string> = {
  homework: "Homework", quiz: "Quiz", test: "Test", practice: "Practice",
};

export default function SubmissionTrace() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const confirm = useConfirm();
  const [data, setData] = useState<LLMCallsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugState, setDebugState] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!submissionId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    // Pull every call for this submission. 200 is comfortably above
    // even pathological pipelines (typical: 5-15 calls per submission).
    // The wide time window makes sure old debug submissions aren't
    // missed — the submission_id filter is selective enough that this
    // doesn't fan out.
    api
      .llmCalls({ submission_id: submissionId, limit: "200", hours: "8760" })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [submissionId]);

  const handleDebug = async (callId: string) => {
    const ok = await confirm({
      title: "Dispatch a debugging agent?",
      message: "It runs on GitHub and posts its findings as an issue.",
      confirmLabel: "Dispatch",
    });
    if (!ok) return;
    setDebugState((s) => ({ ...s, [callId]: "sending" }));
    try {
      await api.debugLLMCall(callId);
      setDebugState((s) => ({ ...s, [callId]: "sent" }));
    } catch {
      setDebugState((s) => ({ ...s, [callId]: "error" }));
    }
  };

  if (error) {
    return (
      <div>
        <div className="page-header">
          <span className="eyebrow">Case file</span>
          <h1>Submission trace</h1>
        </div>
        <p style={{ color: "var(--danger)" }}>{error}</p>
      </div>
    );
  }
  if (!data) return <p className="loading">Loading…</p>;

  const summary = data.submission;

  // Backend returns DESC; the timeline is ASC chronological.
  const calls = [...data.calls].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  // Empty state — a valid submission with no logged calls still shows its
  // case-file header, just with an empty timeline note.
  if (calls.length === 0) {
    return (
      <div>
        <CaseHeader summary={summary} submissionId={submissionId} runPassed failures={0} />
        <p style={{ color: "var(--muted)", marginTop: 20 }}>
          No LLM calls logged for this submission.
        </p>
      </div>
    );
  }

  const totalCost = calls.reduce((s, c) => s + c.cost_usd, 0);
  const totalTokensIn = calls.reduce((s, c) => s + c.input_tokens, 0);
  const totalTokensOut = calls.reduce((s, c) => s + c.output_tokens, 0);
  const failures = calls.filter((c) => !c.success).length;
  const earliest = new Date(calls[0].created_at);
  const latest = new Date(calls[calls.length - 1].created_at);
  const wallMs = latest.getTime() - earliest.getTime();
  const runPassed = failures === 0;

  // Backend caps at limit=200; surface truncation explicitly so a
  // pathological 200+-call submission isn't silently clipped.
  const truncated = data.total_count > calls.length;

  // Group calls into pipeline stages (Vision → Integrity → Grading →
  // Other), preserving chronological order within each stage. Only
  // non-empty stages render, and each becomes an anchor-jump target.
  const stageOrder = [...PIPELINE_BUCKETS.map((b) => b.label), "Other"];
  const stages = stageOrder
    .map((label) => ({
      label,
      anchor: `stage-${label.toLowerCase()}`,
      calls: calls.filter((c) => bucketFor(c.function) === label),
    }))
    .filter((s) => s.calls.length > 0);

  // A stable global chronological index per call for the "+offset from
  // start" timing, so grouping by stage doesn't scramble the numbering.
  const indexOf = new Map(calls.map((c, i) => [c.id, i]));

  return (
    <div>
      <CaseHeader summary={summary} submissionId={submissionId} runPassed={runPassed} failures={failures} />

      {truncated && (
        <p style={{ color: "var(--warn)", fontSize: 12, marginTop: -8, marginBottom: 16 }}>
          Showing {calls.length} of {data.total_count} calls — only the most recent slice is rendered.
        </p>
      )}

      {/* ── Run economics — demoted from the page identity to a thin strip ── */}
      <div className="trace-economics">
        <EconCell label="Calls" value={String(calls.length)} />
        <EconCell label="Cost" value={fmtCost(totalCost)} />
        <EconCell label="Tokens in / out" value={`${totalTokensIn.toLocaleString()} / ${totalTokensOut.toLocaleString()}`} />
        <EconCell label="Wall time" value={calls.length === 1 ? "—" : fmtWallTime(wallMs)} />
        <EconCell
          label="Failures"
          value={String(failures)}
          tone={failures > 0 ? "danger" : "ok"}
        />
      </div>

      {/* ── Stage jumps — pills become anchor jumps into the timeline ── */}
      <div className="trace-jumps" aria-label="Jump to pipeline stage">
        {stages.map((s) => (
          <a
            key={s.anchor}
            href={`#${s.anchor}`}
            className={`trace-jump-pill trace-jump-pill-${s.label.toLowerCase()}`}
          >
            <span className="trace-jump-pill-label">{s.label}</span>
            <span className="trace-jump-pill-count">{s.calls.length}</span>
          </a>
        ))}
      </div>

      {/* ── Staged timeline ─────────────────────────────────────────── */}
      {stages.map((stage) => (
        <section key={stage.anchor} id={stage.anchor} className="trace-stage">
          <h3 className="trace-stage-head">
            <span className={`trace-stage-dot trace-stage-dot-${stage.label.toLowerCase()}`} aria-hidden="true" />
            {stage.label}
            <span className="trace-stage-count">{stage.calls.length}</span>
          </h3>
          <ol className="trace-timeline">
            {stage.calls.map((c) => {
              const gi = indexOf.get(c.id) ?? 0;
              const elapsedMs = new Date(c.created_at).getTime() - earliest.getTime();
              const meta = c.metadata ?? {};
              const posture = typeof meta.posture === "string" ? meta.posture : null;
              const showResults = debugState[c.id] === "sent" || Boolean(meta.debug_dispatched_at);
              return (
                <li key={c.id} className={`trace-row ${c.success ? "" : "trace-row-failed"}`}>
                  <div className="trace-row-rail">
                    <div className="trace-row-index">{gi + 1}</div>
                  </div>
                  <div className="trace-row-body">
                    <div className="trace-row-header">
                      <span className="trace-row-fn">{c.function}</span>
                      {posture && <span className="trace-row-posture">posture: {posture}</span>}
                      {!c.success && <span className="trace-row-failed-tag">FAILED</span>}
                      <span className="trace-row-time" title={c.created_at}>
                        {gi === 0 ? "start" : `+${fmtRelativeMs(elapsedMs)} from start`}
                        {" · "}
                        {formatRelativeDate(c.created_at)}
                      </span>
                    </div>
                    <div className="trace-row-stats">
                      <span>{shortModel(c.model)}</span>
                      <span>
                        {c.input_tokens.toLocaleString()} → {c.output_tokens.toLocaleString()} tokens
                      </span>
                      <span>{c.latency_ms.toFixed(0)}ms</span>
                      <span>{fmtCost(c.cost_usd)}</span>
                      {c.retry_count > 0 && (
                        <span style={{ color: "var(--warn)" }}>{c.retry_count} retries</span>
                      )}
                    </div>
                    <div className="trace-row-meta">
                      <MetadataChips
                        metadata={c.metadata}
                        hidePromoted
                        extraSkipKeys={["posture", "debug_dispatched_at"]}
                      />
                    </div>

                    {/* Failed calls open expanded with the error visible — the
                        whole point of the trace is to see what broke without
                        an extra click. Successful calls stay collapsible. */}
                    {c.success ? (
                      <details className="trace-row-detail">
                        <summary>Show input / output</summary>
                        <div className="trace-row-detail-grid">
                          <div>
                            <strong>Input</strong>
                            <pre>{c.input_text || "(not captured)"}</pre>
                          </div>
                          <div>
                            <strong>Output</strong>
                            <pre>{c.output_text || "(not captured)"}</pre>
                          </div>
                        </div>
                      </details>
                    ) : (
                      <div className="trace-row-detail trace-row-detail-open">
                        <div className="trace-row-detail-grid">
                          <div>
                            <strong>Input</strong>
                            <pre>{c.input_text || "(not captured)"}</pre>
                          </div>
                          <div>
                            <strong style={{ color: "var(--danger)" }}>Error</strong>
                            <pre className="trace-row-error">{c.output_text || "(not captured)"}</pre>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Inline per-row actions: dispatch a debug agent, jump to
                        its findings, and view the whole session's calls. */}
                    <div className="trace-row-actions">
                      <button
                        className="trace-action-btn"
                        onClick={() => handleDebug(c.id)}
                        disabled={debugState[c.id] === "sending"}
                      >
                        🔍 Debug with agent
                      </button>
                      {showResults && (
                        <a
                          className="trace-action-link"
                          href={`https://github.com/${data.repo}/issues?q=${encodeURIComponent(`is:issue label:llm-debug ${c.id}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open the debug agent's findings for this call on GitHub"
                        >
                          🔗 Debug results
                        </a>
                      )}
                      {c.session_id && (
                        <Link
                          className="trace-action-link"
                          to={`/llm-calls?session=${c.session_id}&hours=8760`}
                          title={`View every call in session ${c.session_id}`}
                        >
                          🧵 View session
                        </Link>
                      )}
                      {debugState[c.id] === "sending" && (
                        <span className="trace-action-note">Dispatching…</span>
                      )}
                      {debugState[c.id] === "sent" && (
                        <span className="trace-action-note" style={{ color: "var(--ok)" }}>
                          Dispatched — results appear under 🔗 once the agent finishes.
                        </span>
                      )}
                      {debugState[c.id] === "error" && (
                        <span className="trace-action-note" style={{ color: "var(--danger)" }}>
                          Dispatch failed (token configured?).
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <div style={{ marginTop: 24 }}>
        <Link to={`/llm-calls?submission=${submissionId}`}>← Back to LLM Calls list view</Link>
      </div>
    </div>
  );
}

// ── Case-file header: identity + the decisions this run produced ──────

function CaseHeader({
  summary, submissionId, runPassed, failures,
}: {
  summary: SubmissionSummary | null;
  submissionId: string | undefined;
  runPassed: boolean;
  failures: number;
}) {
  const runTitle = runPassed
    ? "Every logged call in this run succeeded"
    : `${failures} call${failures === 1 ? "" : "s"} in this run failed`;

  return (
    <div className="case-file">
      <div className="case-head">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Case file</span>
          <h1 style={{ marginBottom: 4 }}>
            {summary?.student_name ? (
              <Link to={`/llm-calls?user=${summary.student_id}`} title="View this student's LLM calls">
                {summary.student_name}
              </Link>
            ) : (
              "Submission trace"
            )}
          </h1>
          <div className="case-meta">
            {summary?.school_name && summary.school_id && (
              <Link to={`/schools/${summary.school_id}`} className="case-meta-link">
                {summary.school_name}
              </Link>
            )}
            {summary?.assignment_title && (
              <span className="case-meta-item" title={summary.assignment_title}>
                {summary.assignment_type ? `${ASSIGNMENT_TYPE_LABEL[summary.assignment_type] ?? summary.assignment_type}: ` : ""}
                {summary.assignment_title}
              </span>
            )}
            {summary?.status && (
              <span className="case-meta-item case-meta-muted">{summary.status.replace(/_/g, " ")}</span>
            )}
            {submissionId && (
              <span className="case-meta-id" title={submissionId}>id {shortId(submissionId)}</span>
            )}
          </div>
        </div>
        <StatusPill
          tone={runPassed ? "ok" : "danger"}
          label={runPassed ? "PASS" : "FAILED"}
          title={runTitle}
        />
      </div>

      {summary && <DecisionStrip summary={summary} />}
      {!summary && (
        <p className="case-no-record">
          No submission record found for this id — showing logged calls only.
        </p>
      )}
    </div>
  );
}

// The three decisions the run produced: AI grade, integrity verdict,
// teacher action. Hairline-separated cells matching the Overview aesthetic.
function DecisionStrip({ summary }: { summary: SubmissionSummary }) {
  const integrity = integrityPill(summary);
  const action = teacherAction(summary);

  const aiValue = summary.ai_grading_status === "skipped_unreadable"
    ? "Unreadable"
    : pct(summary.ai_score);
  const aiSub = summary.ai_grading_status === "skipped_unreadable"
    ? "extraction below readable threshold"
    : summary.final_score != null
      && summary.ai_score != null
      && Math.round(summary.final_score) !== Math.round(summary.ai_score)
      ? `final ${pct(summary.final_score)} after review`
      : "AI grade — teacher approves before it posts";

  return (
    <div className="case-decisions">
      <div className="case-decision">
        <div className="case-decision-label">AI grade</div>
        <div className="case-decision-value">{aiValue}</div>
        <div className="case-decision-sub">{aiSub}</div>
      </div>
      <div className="case-decision">
        <div className="case-decision-label">Integrity verdict</div>
        <div className="case-decision-value case-decision-pill">
          <StatusPill tone={integrity.tone} label={integrity.label} />
        </div>
        <div className="case-decision-sub">
          {summary.integrity_headline
            ?? (summary.integrity_resolution && summary.integrity_resolution !== "unresolved"
              ? summary.integrity_resolution.replace(/_/g, " ")
              : "understanding check")}
        </div>
      </div>
      <div className="case-decision">
        <div className="case-decision-label">Teacher action</div>
        <div className="case-decision-value case-decision-action">{action.label}</div>
        <div className="case-decision-sub">{action.sub}</div>
      </div>
    </div>
  );
}

function EconCell({ label, value, tone }: { label: string; value: string; tone?: "ok" | "danger" }) {
  return (
    <div className="trace-econ-cell">
      <span className="trace-econ-label">{label}</span>
      <span
        className="trace-econ-value"
        style={tone === "danger" ? { color: "var(--danger)" } : tone === "ok" ? { color: "var(--ok)" } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
