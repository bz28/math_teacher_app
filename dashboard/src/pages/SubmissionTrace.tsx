import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  type ExtractionDetail,
  type LLMCallsData,
  type SubmissionSummary,
} from "../lib/api";
import {
  fmtCost,
  fmtRelativeMs,
  fmtWallTime,
  formatRelativeDate,
  shortId,
  shortModel,
} from "../lib/format";
import { LLM_MODES, PIPELINE_BUCKETS, bucketFor } from "../lib/llm_modes";
import MetadataChips from "../components/MetadataChips";
import StatusPill, { type PillTone } from "../components/StatusPill";
import ExtractionReadout from "../components/ExtractionReadout";
import { STAGE_META, isStalled, noCallsDiagnosis } from "../lib/stages";
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
    // Only claim the AI drafted it when the AI actually scored it.
    // `graded_at` is stamped by a teacher saving a breakdown by hand as
    // well as by the grader, and hand-grading is the NORMAL path after
    // the student rejects the read — a stage this page surfaces. The
    // stage pill a few elements away is worded to avoid this exact
    // claim; the two must not contradict each other.
    return {
      label: "Awaiting teacher review",
      sub: s.ai_score != null
        ? "AI grade drafted — not yet approved"
        : "graded by hand — not yet approved",
    };
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
  const [work, setWork] = useState<ExtractionDetail | null>(null);
  // The two fetches are independent, so the calls can land first. Without
  // this the empty-call diagnosis would fire against a `work` that is
  // merely still in flight and report "couldn't be loaded" on a healthy
  // page for as long as the round trip takes.
  const [workLoaded, setWorkLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugState, setDebugState] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!submissionId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setWork(null);
    setWorkLoaded(false);
    setError(null);
    // The student's own work: the photos, what Vision made of them, and
    // the confirm stamps. Failure is non-fatal — the call timeline is
    // still worth rendering without it.
    //
    // The realistic failure is this endpoint alone: it returns the
    // photos as inline base64, so it can time out or trip a response
    // size limit on a submission where the small /llm-calls fetch
    // beside it succeeds. (NOT a deleted assignment or course — both
    // FKs cascade, so a submission cannot outlive either.) Everything
    // downstream must therefore treat a null `work` as "unknown",
    // never as "absent".
    api
      .extractionDetail(submissionId)
      .then((d) => { if (!cancelled) { setWork(d); setWorkLoaded(true); } })
      .catch(() => { if (!cancelled) { setWork(null); setWorkLoaded(true); } });
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

  // Empty state — a valid submission with no logged calls. This used to
  // be a one-line shrug, which reads as "nothing to see" when it is
  // usually the most interesting thing on the page: there are only a few
  // ways to get here and the stored facts tell them apart, so say which.
  if (calls.length === 0) {
    const why = workLoaded ? noCallsDiagnosis(work, 0) : null;
    return (
      <div>
        <CaseHeader
          summary={summary} submissionId={submissionId}
          runPassed failures={0} work={work} hasCalls={false}
        />
        <Lifecycle work={work} summary={summary} firstReadAt={null} />
        {!workLoaded && <p className="loading">Loading the submission…</p>}
        {why && (
          <div className="cf-why">
            <div className="cf-why-head">{why.headline}</div>
            <p className="cf-why-body">{why.detail}</p>
          </div>
        )}
        <StudentWork work={work} />
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

  // When Vision actually read the page. `Submission` stores no
  // extraction timestamp, but the call that produced it is right here in
  // the timeline — so the trace can date the read exactly where the
  // student page can only approximate from submission.
  //
  // The mode is INTEGRITY_EXTRACT, not IMAGE_EXTRACT. Both sit in the
  // Vision bucket and the names invite the mix-up, but only this one
  // reads a submission: `extract_student_work` passes
  // LLMMode.INTEGRITY_EXTRACT with a submission_id, while
  // `extract_problems_from_image` — IMAGE_EXTRACT — is the teacher
  // scanning an assignment and carries no submission_id at all. Since
  // `calls` is filtered by submission_id, matching IMAGE_EXTRACT here
  // matches nothing, ever: the strip would report "Reader ran —" on a
  // submission whose read is sitting in the timeline directly below it.
  //
  // `success` is load-bearing: a FAILED read is the single most common
  // way to reach "AI on, photos uploaded, no extraction stored". Dating
  // the hop from it would stamp "Reader ran <date>" over precisely the
  // submission whose read never landed.
  const firstRead = calls.find(
    (c) => c.function === LLM_MODES.INTEGRITY_EXTRACT && c.success,
  );
  // A read was attempted and threw. The strip can then say so outright
  // instead of the weaker "never arrived", which is what it has to fall
  // back on when nothing was logged at all.
  const readFailed = calls.some(
    (c) => c.function === LLM_MODES.INTEGRITY_EXTRACT && !c.success,
  );

  return (
    <div>
      <CaseHeader
        summary={summary} submissionId={submissionId}
        runPassed={runPassed} failures={failures} work={work} hasCalls
      />

      <Lifecycle
        work={work}
        summary={summary}
        firstReadAt={firstRead?.created_at ?? null}
        readFailed={readFailed}
      />

      <StudentWork work={work} />

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
  summary, submissionId, runPassed, failures, work, hasCalls,
}: {
  summary: SubmissionSummary | null;
  submissionId: string | undefined;
  runPassed: boolean;
  failures: number;
  work: ExtractionDetail | null;
  /** Whether any call was logged at all. With none, the run pill is a
   *  verdict about an empty set. */
  hasCalls: boolean;
}) {
  const runTitle = runPassed
    ? "Every logged call in this run succeeded"
    : `${failures} call${failures === 1 ? "" : "s"} in this run failed`;

  // The pill used to read PASS whenever nothing failed — including when
  // nothing ran. On a submission stuck six days with zero calls that is
  // the most prominent thing on the page and it says the opposite of
  // the truth: "no calls failed" is not "this submission is fine". With
  // no calls to judge, show where the submission actually stopped.
  //
  // And when there are no calls AND no record loaded, show NOTHING. An
  // earlier guard fell through to PASS in that case, so the heavy
  // submission fetch being slow painted a green PASS over a stalled
  // submission for the length of the round trip — and painted it
  // permanently if that fetch failed, directly above a body reading
  // "the submission record couldn't be loaded". A verdict is a claim;
  // with neither the calls nor the record there is nothing to claim.
  const stagePill = !hasCalls && work ? STAGE_META[work.stage] : null;

  return (
    <div className="case-file">
      <div className="case-head">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Case file</span>
          <h1 style={{ marginBottom: 4 }}>
            {summary?.student_name ? (
              // Up to the student's whole case file, not sideways into a
              // raw call list — this submission is one row on that page.
              <Link
                to={`/students/${summary.student_id}`}
                title="Open this student's case file"
              >
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
        {hasCalls ? (
          <StatusPill
            tone={runPassed ? "ok" : "danger"}
            label={runPassed ? "PASS" : "FAILED"}
            title={runTitle}
          />
        ) : stagePill ? (
          <StatusPill
            tone={stagePill.tone}
            label={stagePill.label}
            title={stagePill.blurb}
          />
        ) : null}
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

// ── Lifecycle: the hops, and the gaps between them ───────────────────

/** The gap between two moments, in the coarsest unit that stays true.
 *  The finding on this strip is nearly always a gap, not an event. */
function gapLabel(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 90_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 5_400_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 172_800_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

interface Hop {
  label: string;
  at: string | null;
  /** Rendered open-ended and in danger tone — the run stops here and
   *  something that WAS owed is not coming. Reserved for an actual
   *  stall; see `absent` for the hop that was never owed at all. */
  pending?: boolean;
  /** Neutral, quiet: this hop never happened and was never supposed to.
   *  Both toggles off is the case — nothing was owed, so painting it
   *  danger red would contradict the neutral AI OFF pill and the "the
   *  empty timeline is correct" explainer on the same screen, and would
   *  report the teacher's setting as a broken pipeline. That inversion
   *  is the exact confusion this whole surface exists to prevent. */
  absent?: boolean;
  note?: string;
}

/**
 * Submitted → read → confirmed → graded → published, with the elapsed
 * gap rendered between the stamps rather than beside them.
 *
 * The question this answers is the one the call timeline below cannot:
 * a submission can have a perfectly healthy set of Vision calls and
 * still be dead, because the student never pressed Confirm and every
 * downstream step is gated on that. The strip ends in an open pending
 * node when that is what happened, so the break is visible as a shape
 * before anything is read.
 */
function Lifecycle({
  work, summary, firstReadAt, readFailed = false,
}: {
  work: ExtractionDetail | null;
  summary: SubmissionSummary | null;
  firstReadAt: string | null;
  /** An `integrity_extract` call was logged and failed. NOT
   *  `image_extract` — see the note where this is computed; that mode
   *  never carries a submission_id and matching it finds nothing. */
  readFailed?: boolean;
}) {
  if (!work && !summary) return null;

  const submittedAt = work?.submitted_at ?? null;
  const readAt = firstReadAt ?? null;
  const ruledAt = work?.confirmed_at ?? work?.flagged_at ?? null;
  const stalled = work ? isStalled(work.stage) : false;

  const hops: Hop[] = [
    { label: "Submitted", at: submittedAt },
  ];

  if (work?.extraction_present) {
    hops.push({
      label: "Reader ran",
      at: readAt,
      note: work.extraction_empty ? "found nothing" : undefined,
    });
  } else if (readAt && !work) {
    // A read ran, and the submission record didn't load — so whether it
    // was STORED is simply unknown here. Say only what the timeline
    // proves and stop: claiming "never stored" off a failed fetch would
    // invent a defect, and there is no StudentWork section rendered to
    // contradict it. Matches `noCallsDiagnosis`, which refuses to
    // diagnose without the record for the same reason.
    hops.push({ label: "Reader ran", at: readAt });
  } else if (readAt) {
    // The call succeeded and nothing was stored. `sub.extraction` is
    // assigned and committed AFTER the Vision call returns, so a failed
    // commit or a restart inside that window lands exactly here. Dating
    // a completed hop from the call would put "Reader ran <date>" beside
    // a NO READ pill and a readout saying no read is stored — three
    // claims, one of them false. It is a stall, so it renders as one.
    hops.push({
      label: "Reader ran",
      at: readAt,
      pending: true,
      note: "read never stored",
    });
  } else if (work) {
    const owed = work.integrity_check_enabled || work.ai_grading_enabled;
    hops.push({
      label: "Reader ran",
      at: null,
      // Owed-and-missing is a stall; not-owed is just a step that never
      // applied. Same absence, and the page must not colour them alike.
      pending: owed,
      absent: !owed,
      note: readFailed
        ? "the read failed"
        : owed
          ? "never arrived"
          : "AI off for this HW",
    });
  }

  if (work?.confirmed_at) {
    hops.push({
      label: "Student confirmed",
      at: work.confirmed_at,
      note: work.edited_at ? "after correcting the read" : undefined,
    });
  } else if (work?.flagged_at) {
    hops.push({ label: "Student rejected the read", at: work.flagged_at });
  } else if (work?.extraction_present) {
    // The case this whole surface was built for. Labelled for what is
    // happening rather than what didn't — "Student confirmed … never
    // ruled" contradicts itself in the space of four words.
    hops.push({
      label: "Awaiting student",
      at: null,
      pending: true,
      note: "never ruled on the read",
    });
  }

  if (summary?.graded_at) {
    hops.push({ label: "Graded", at: summary.graded_at });
  }
  if (summary?.reviewed_at) {
    hops.push({ label: "Teacher reviewed", at: summary.reviewed_at });
  }
  if (summary?.grade_published_at) {
    hops.push({ label: "Published", at: summary.grade_published_at });
  }

  // How long the open end has been open — the number an operator acts on.
  const openSince = stalled ? (ruledAt ?? readAt ?? submittedAt) : null;
  const waitingFor = openSince
    ? gapLabel(openSince, new Date().toISOString())
    : null;

  return (
    <ol className="cf-life" aria-label="Submission lifecycle">
      {hops.map((h, i) => {
        const gap = i === 0 ? null : gapLabel(hops[i - 1].at, h.at);
        // "Pending" means the run STOPS here. A hop with something after
        // it plainly didn't stop anything — a teacher hand-grading an
        // unconfirmed submission leaves "Awaiting student" mid-strip
        // with "Graded" beyond it — so it renders as skipped rather
        // than as an open-ended stall the operator should chase.
        const stalled = h.pending && i === hops.length - 1;
        const quiet = h.absent || (h.pending && !stalled);
        return (
          <li
            key={h.label}
            className={`cf-life-hop${stalled ? " cf-life-hop-pending" : ""}${
              quiet ? " cf-life-hop-absent" : ""
            }`}
          >
            {i > 0 && (
              <span className="cf-life-gap" aria-hidden="true">
                {gap ?? ""}
              </span>
            )}
            <span className="cf-life-dot" aria-hidden="true" />
            <span className="cf-life-label">{h.label}</span>
            <span className="cf-life-at">
              {h.at ? (
                <span title={h.at}>{formatRelativeDate(h.at)}</span>
              ) : stalled && waitingFor ? (
                // Only a genuine stall is aged. A skipped or never-owed
                // hop has nothing to wait for, so "waiting 6d" there
                // would invent an obligation that never existed.
                `waiting ${waitingFor}`
              ) : (
                "—"
              )}
            </span>
            {h.note && <span className="cf-life-note">{h.note}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// ── The student's own work, beside what the reader made of it ────────

function StudentWork({ work }: { work: ExtractionDetail | null }) {
  if (!work) return null;
  const corrected = work.rows.filter((r) => r.changed).length;
  const meta = STAGE_META[work.stage];
  return (
    <section className="cf-work">
      <h3 className="cf-work-head">
        Student work
        <span className="cf-work-sub">
          {work.files_count === 1 ? "1 page" : `${work.files_count} pages`}
          {work.rows.length > 0 && (
            <>
              {" · "}
              {corrected === 0
                ? `${work.rows.length} rows read, none corrected`
                : `${corrected} of ${work.rows.length} rows corrected by the student`}
            </>
          )}
        </span>
        <span className="cf-work-stage">
          <StatusPill tone={meta.tone} label={meta.label} title={meta.blurb} />
        </span>
      </h3>
      <ExtractionReadout detail={work} />
    </section>
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
