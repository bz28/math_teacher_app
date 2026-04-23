"use client";

import { useEffect, useState } from "react";
import {
  teacher,
  type IntegrityDisposition,
  type IntegrityOverview,
  type IntegrityRubric,
  type TeacherIntegrityDetail,
  type TeacherIntegrityProblemRow,
  type TeacherIntegrityTranscriptTurn,
  type TeacherSubmissionDetail,
  type TeacherSubmissionRow,
} from "@/lib/api";
import { ExtractionView } from "@/components/school/shared/extraction-view";
import { cn } from "@/lib/utils";

// ── Disposition badge ──

const DISPOSITION_CONFIG: Record<
  IntegrityDisposition,
  { label: string; icon: string; cls: string }
> = {
  pass: {
    label: "Pass",
    icon: "✓",
    cls: "bg-green-100 text-green-700 dark:bg-green-500/20",
  },
  needs_practice: {
    label: "Needs practice",
    icon: "↻",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-500/20",
  },
  tutor_pivot: {
    label: "Tutored",
    icon: "?",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/20",
  },
  flag_for_review: {
    label: "Review",
    icon: "⚑",
    cls: "bg-red-100 text-red-700 dark:bg-red-500/20",
  },
};

function DispositionPill({
  disposition,
  subtle,
}: {
  disposition: IntegrityDisposition;
  subtle?: boolean;
}) {
  const cfg = DISPOSITION_CONFIG[disposition];
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-bold",
        subtle ? "bg-gray-100 text-gray-500 dark:bg-gray-500/20" : cfg.cls,
      )}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

function OverviewBadge({ overview }: { overview: IntegrityOverview | null }) {
  if (!overview) return null;
  // Unreadable / complete-but-no-disposition (turn-cap fallback) is a
  // teacher-review situation — surface it distinctly rather than as
  // an empty completed state.
  if (overview.overall_status === "complete" && !overview.disposition) {
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600 dark:bg-gray-500/20">
        Needs review
      </span>
    );
  }
  if (overview.overall_status !== "complete" || !overview.disposition) {
    const progress = `${overview.complete_count}/${overview.problem_count}`;
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500 dark:bg-gray-500/20">
        {overview.complete_count === 0 ? "Pending" : `In progress ${progress}`}
      </span>
    );
  }
  return <DispositionPill disposition={overview.disposition} />;
}

// ── Rubric display ──

const RUBRIC_DIM_LABELS: Record<keyof IntegrityRubric, string> = {
  paraphrase_originality: "Own words vs textbook",
  causal_fluency: "Why, not just what",
  transfer: "Flex to a twist",
  prediction: "Predict before computing",
  authority_resistance: "Push back on wrong premise",
  self_correction: "Catches own errors",
};

const RUBRIC_SCORE_STYLES: Record<string, string> = {
  low: "text-red-600 dark:text-red-400",
  mid: "text-amber-600 dark:text-amber-400",
  high: "text-green-600 dark:text-green-400",
  not_probed: "text-text-muted italic",
  not_observed: "text-text-muted italic",
};

function RubricDisplay({ rubric }: { rubric: IntegrityRubric }) {
  const rows: { key: keyof IntegrityRubric; score: string }[] = (
    Object.keys(RUBRIC_DIM_LABELS) as (keyof IntegrityRubric)[]
  ).map((key) => ({ key, score: rubric[key] }));
  return (
    <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs">
      {rows.map(({ key, score }) => (
        <div key={key} className="contents">
          <dt className="text-text-muted">{RUBRIC_DIM_LABELS[key]}</dt>
          <dd
            className={cn(
              "font-medium",
              RUBRIC_SCORE_STYLES[score] ?? "text-text-muted",
            )}
          >
            {score.replace(/_/g, " ")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ── Behavioral evidence summary (aggregated telemetry) ──

/** Format milliseconds as "Xm Ys" or "Ys" for short intervals. */
function formatMs(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/**
 * Aggregates behavioral telemetry across all student turns into a
 * compact summary: total tab-outs + away-time, paste count + largest,
 * cadence anomalies, need-more-time signal, device hint. Hides
 * entirely when no student turn carries telemetry (older submissions
 * from pre-telemetry, or checks that completed via skipped_unreadable
 * / turn cap with no student messages).
 *
 * Visual treatment: neutral-styled for non-flag dispositions (signals
 * are context), amber-tinted border for flag_for_review (signals are
 * evidence the teacher is there to evaluate).
 */
function BehavioralEvidence({
  transcript,
  disposition,
}: {
  transcript: TeacherIntegrityTranscriptTurn[];
  disposition: IntegrityDisposition | null;
}) {
  const studentTurns = transcript.filter((t) => t.role === "student");
  const withTelemetry = studentTurns.filter((t) => t.telemetry != null);
  if (withTelemetry.length === 0) return null;

  // Aggregate across all student turns.
  let blurCount = 0;
  let blurTotalMs = 0;
  let pasteCount = 0;
  let largestPaste = 0;
  let cadencePauses = 0;
  let cadenceEdits = 0;
  let needMoreTime = false;
  let device: "desktop" | "mobile" | null = null;

  for (const t of withTelemetry) {
    const tel = t.telemetry;
    if (!tel) continue;
    for (const ev of tel.focus_blur_events) {
      blurCount += 1;
      blurTotalMs += ev.duration_ms;
    }
    for (const ev of tel.paste_events) {
      pasteCount += 1;
      if (ev.byte_count > largestPaste) largestPaste = ev.byte_count;
    }
    if (tel.typing_cadence) {
      cadencePauses += tel.typing_cadence.pauses_over_3s;
      cadenceEdits += tel.typing_cadence.edits;
    }
    if (tel.need_more_time_used) needMoreTime = true;
    if (tel.device_type) device = tel.device_type;
  }

  const flagged = disposition === "flag_for_review";
  return (
    <div
      className={cn(
        "rounded-[--radius-sm] border px-3 py-2 text-xs",
        flagged
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
          : "border-border-light bg-bg-subtle text-text-secondary",
      )}
    >
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide">
        Behavioral signals
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
        <dt className="opacity-70">Tabbed away</dt>
        <dd className="font-medium">
          {blurCount === 0
            ? "never"
            : `${blurCount}× (${formatMs(blurTotalMs)} total)`}
        </dd>

        <dt className="opacity-70">Paste events</dt>
        <dd className="font-medium">
          {pasteCount === 0
            ? "none"
            : `${pasteCount} (largest ${largestPaste} chars)`}
        </dd>

        <dt className="opacity-70">Cadence</dt>
        <dd className="font-medium">
          {cadencePauses === 0 && cadenceEdits === 0
            ? "steady typing"
            : `${cadencePauses} long pauses, ${cadenceEdits} edits`}
        </dd>

        {needMoreTime && (
          <>
            <dt className="opacity-70">Asked for more time</dt>
            <dd className="font-medium">yes</dd>
          </>
        )}

        {device && (
          <>
            <dt className="opacity-70">Device</dt>
            <dd className="font-medium">{device}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

// ── Integrity detail section (expandable inside submission detail) ──

function IntegritySection({ submissionId }: { submissionId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TeacherIntegrityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [dismissConfirm, setDismissConfirm] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await teacher.integrityDetail(submissionId);
      setData(d);
    } catch {
      setError("Couldn't load integrity details.");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // Always refetch on open so teachers don't see stale data after
    // the student keeps chatting or another teacher dismisses a
    // problem. The existing `loading` guard prevents parallel fetches
    // if they spam the toggle.
    if (next && !loading) load();
  }

  async function dismiss(problemId: string) {
    setDismissingId(problemId);
    try {
      await teacher.dismissIntegrityProblem(submissionId, problemId, dismissReason);
      await load();
      setDismissConfirm(null);
      setDismissReason("");
    } catch {
      setError("Couldn't dismiss. Try again.");
    } finally {
      setDismissingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-2 text-sm font-semibold text-text-primary hover:text-primary"
      >
        <span className="text-xs">{open ? "▼" : "▶"}</span>
        Understanding Check
        {data && data.disposition && (
          <OverallHeaderBadge disposition={data.disposition} />
        )}
        {data &&
          !data.disposition &&
          data.overall_status === "complete" && (
            <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600 dark:bg-gray-500/20">
              Needs review
            </span>
          )}
      </button>

      {open && loading && <p className="text-xs text-text-muted">Loading…</p>}
      {open && error && <p className="text-xs text-error">{error}</p>}

      {open && data && (
        <>
          {data.overall_status === "no_check" && (
            <p className="text-xs text-text-muted">
              No integrity check for this submission.
            </p>
          )}

          {data.problems.length === 0 && data.overall_status !== "no_check" && (
            <p className="text-xs text-text-muted">
              {data.overall_status === "extracting"
                ? "Preparing the check…"
                : "Waiting for student to complete the check."}
            </p>
          )}

          {data.student_flagged_extraction && (
            <div className="rounded-[--radius-sm] border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10">
              ⚠ Student flagged the reader&rsquo;s extraction as inaccurate.
              Check &ldquo;What the agent saw&rdquo; against their photo
              before trusting the verdict.
            </div>
          )}

          {data.overall_summary && (
            <p className="text-sm italic text-text-secondary">
              {data.overall_summary}
            </p>
          )}

          {data.inline_variant_used && data.inline_variant_result && (
            <p className="text-xs text-text-muted">
              Variant probe:{" "}
              <span className="font-medium text-text-secondary">
                {data.inline_variant_result.replace(/_/g, " ")}
              </span>
            </p>
          )}

          <BehavioralEvidence
            transcript={data.transcript}
            disposition={data.disposition}
          />

          {data.problems.map((p) => (
            <ProblemCard
              key={p.problem_id}
              problem={p}
              dismissConfirm={dismissConfirm}
              dismissReason={dismissReason}
              dismissingId={dismissingId}
              onStartDismiss={(id) => {
                setDismissConfirm(id);
                setDismissReason("");
              }}
              onCancelDismiss={() => setDismissConfirm(null)}
              onDismiss={dismiss}
              onDismissReasonChange={setDismissReason}
            />
          ))}

          {data.transcript.length > 0 && (
            <div>
              <button
                onClick={() => setTranscriptOpen((v) => !v)}
                className="flex w-full items-center gap-2 text-xs font-semibold text-text-secondary hover:text-primary"
              >
                <span>{transcriptOpen ? "▼" : "▶"}</span>
                Full conversation ({data.transcript.length} turns)
              </button>
              {transcriptOpen && (
                <TranscriptView transcript={data.transcript} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OverallHeaderBadge({
  disposition,
}: {
  disposition: IntegrityDisposition;
}) {
  const cfg = DISPOSITION_CONFIG[disposition];
  return (
    <span
      className={cn(
        "ml-auto rounded-full px-2 py-0.5 text-xs font-bold",
        cfg.cls,
      )}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

function ProblemCard({
  problem: p,
  dismissConfirm,
  dismissReason,
  dismissingId,
  onStartDismiss,
  onCancelDismiss,
  onDismiss,
  onDismissReasonChange,
}: {
  problem: TeacherIntegrityProblemRow;
  dismissConfirm: string | null;
  dismissReason: string;
  dismissingId: string | null;
  onStartDismiss: (id: string) => void;
  onCancelDismiss: () => void;
  onDismiss: (id: string) => void;
  onDismissReasonChange: (v: string) => void;
}) {
  const isDismissed = p.teacher_dismissed;
  const [sawOpen, setSawOpen] = useState(false);
  const [rubricOpen, setRubricOpen] = useState(false);

  return (
    <div
      className={cn(
        "space-y-2 rounded-[--radius-sm] border p-3",
        isDismissed ? "border-border-light bg-background opacity-60" : "border-border bg-surface",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-text-secondary">
          Problem {p.sample_position + 1}
        </span>
        <div className="flex items-center gap-2">
          {isDismissed && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500 dark:bg-gray-500/20">
              Dismissed
            </span>
          )}
          {p.status === "skipped_unreadable" && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600 dark:bg-gray-500/20">
              Unreadable
            </span>
          )}
        </div>
      </div>

      {p.ai_reasoning && !isDismissed && (
        <p className="text-xs italic text-text-muted">{p.ai_reasoning}</p>
      )}

      {isDismissed && p.teacher_dismissal_reason && (
        <p className="text-xs text-text-muted">
          Reason: {p.teacher_dismissal_reason}
        </p>
      )}

      {/* Rubric — collapsible, collapsed by default */}
      {p.rubric && !isDismissed && (
        <div>
          <button
            onClick={() => setRubricOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-primary"
          >
            <span className="text-[10px]">{rubricOpen ? "▼" : "▶"}</span>
            Rubric
          </button>
          {rubricOpen && <RubricDisplay rubric={p.rubric} />}
        </div>
      )}

      {/* What the agent saw — collapsible, collapsed by default */}
      {p.student_work_extraction && !isDismissed && (
        <div>
          <button
            onClick={() => setSawOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-primary"
          >
            <span className="text-[10px]">{sawOpen ? "▼" : "▶"}</span>
            What the agent saw
          </button>
          {sawOpen && <ExtractionView extraction={p.student_work_extraction} />}
        </div>
      )}

      {!isDismissed && (
        <>
          {dismissConfirm === p.problem_id ? (
            <div className="space-y-1.5">
              <textarea
                value={dismissReason}
                onChange={(e) => onDismissReasonChange(e.target.value)}
                placeholder="Reason (optional)"
                rows={2}
                className="w-full rounded-[--radius-sm] border border-border bg-background px-2 py-1 text-xs text-text-primary placeholder:text-text-muted"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => onDismiss(p.problem_id)}
                  disabled={dismissingId === p.problem_id}
                  className="rounded-[--radius-sm] bg-red-500 px-2 py-1 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-50"
                >
                  {dismissingId === p.problem_id ? "Dismissing…" : "Confirm dismiss"}
                </button>
                <button
                  onClick={onCancelDismiss}
                  className="rounded-[--radius-sm] border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:text-primary"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => onStartDismiss(p.problem_id)}
              className="text-xs font-medium text-text-muted hover:text-red-500"
            >
              Dismiss this check
            </button>
          )}
        </>
      )}
    </div>
  );
}

function TranscriptView({
  transcript,
}: {
  transcript: TeacherIntegrityTranscriptTurn[];
}) {
  return (
    <div className="mt-2 space-y-2 rounded-[--radius-sm] border border-border-light bg-background p-3">
      {transcript.map((t) => (
        <TranscriptTurn key={`${t.ordinal}-${t.role}`} turn={t} />
      ))}
    </div>
  );
}

function TranscriptTurn({ turn }: { turn: TeacherIntegrityTranscriptTurn }) {
  const ts = new Date(turn.created_at);
  const stamp = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (turn.role === "tool_call") {
    return (
      <div className="text-[11px] text-text-muted">
        <span className="font-semibold">Agent tool:</span>{" "}
        <span className="font-mono">{turn.tool_name ?? "(tool)"}</span>
        <span className="ml-2 font-mono text-text-muted">{turn.content}</span>
      </div>
    );
  }
  if (turn.role === "tool_result") {
    return (
      <div className="text-[11px] italic text-text-muted">
        <span className="font-semibold">Tool result:</span> {turn.content}
      </div>
    );
  }

  const isStudent = turn.role === "student";
  return (
    <div className={cn("flex gap-2", isStudent ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-[--radius-sm] px-2 py-1 text-xs",
          isStudent
            ? "bg-primary/10 text-text-primary"
            : "bg-surface text-text-primary",
        )}
      >
        <div className="font-semibold">
          {isStudent ? "Student" : "Agent"}
          <span className="ml-2 font-normal text-text-muted">{stamp}</span>
          {turn.seconds_on_turn != null && isStudent && (
            <span className="ml-2 font-normal text-text-muted">
              · {turn.seconds_on_turn}s
            </span>
          )}
        </div>
        <div className="mt-0.5 whitespace-pre-wrap">{turn.content}</div>
      </div>
    </div>
  );
}

// ── Main panel ──

interface Props {
  assignmentId: string;
  onClose: () => void;
}

/**
 * Modal that lists all submissions for a homework, with a click-to-
 * expand per-submission detail subview. Wired up from the
 * `⚙ Submissions` button in homework-detail-modal.tsx.
 */
export function SubmissionsPanel({ assignmentId, onClose }: Props) {
  const [rows, setRows] = useState<TeacherSubmissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeacherSubmissionDetail | null>(null);
  const detailLoading = openId !== null && detail === null && error === null;

  useEffect(() => {
    teacher
      .submissions(assignmentId)
      .then((d) => setRows(d.submissions))
      .catch(() => setError("Couldn't load submissions."));
  }, [assignmentId]);

  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    teacher
      .submissionDetail(openId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load submission detail.");
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  function closeDetail() {
    setOpenId(null);
    setDetail(null);
    setError(null);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-[--radius-lg] bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-light px-6 py-4">
          <h2 className="text-lg font-bold text-text-primary">
            {openId && detail
              ? `${detail.student_name} — ${detail.assignment_title}`
              : "Submissions"}
          </h2>
          <button
            onClick={openId ? closeDetail : onClose}
            className="rounded-[--radius-sm] border border-border-light px-3 py-1 text-xs font-bold text-text-secondary hover:bg-bg-subtle"
          >
            {openId ? "← Back to list" : "Close"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && <p className="text-sm text-error">{error}</p>}

          {!openId && rows === null && !error && (
            <p className="text-sm text-text-muted">Loading…</p>
          )}

          {!openId && rows && rows.length === 0 && (
            <p className="text-sm text-text-muted">No submissions yet.</p>
          )}

          {!openId && rows && rows.length > 0 && (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className="flex cursor-pointer items-center justify-between rounded-[--radius-sm] border border-border bg-surface p-4 hover:border-primary"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-text-primary">
                        {r.student_name || r.student_email}
                      </div>
                      {r.is_preview && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-500/20">
                          Preview
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-text-muted">{r.student_email}</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    {r.is_late && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-500/20">
                        LATE
                      </span>
                    )}
                    <OverviewBadge overview={r.integrity_overview} />
                    {r.submitted_at && (
                      <span>{new Date(r.submitted_at).toLocaleDateString()}</span>
                    )}
                    <span>→</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {openId && detailLoading && (
            <p className="text-sm text-text-muted">Loading…</p>
          )}

          {openId && detail && (
            <div className="space-y-6">
              <div className="text-xs text-text-muted">
                Submitted {new Date(detail.submitted_at).toLocaleString()}
                {detail.is_late && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-500/20">
                    LATE
                  </span>
                )}
              </div>

              <div>
                <div className="text-sm font-semibold text-text-primary">
                  Submitted work
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={detail.image_data ?? ""}
                  alt={`${detail.student_name}'s submitted homework`}
                  className="mt-2 max-h-[600px] w-full rounded-[--radius-sm] border border-border object-contain"
                />
              </div>

              <IntegritySection submissionId={openId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
