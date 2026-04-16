"use client";

import { useEffect, useState } from "react";
import {
  teacher,
  type IntegrityBadge,
  type IntegrityOverview,
  type TeacherIntegrityDetail,
  type TeacherIntegrityProblemRow,
  type TeacherIntegrityTranscriptTurn,
  type TeacherSubmissionDetail,
  type TeacherSubmissionRow,
} from "@/lib/api";
import { ExtractionView } from "@/components/school/shared/extraction-view";
import { cn } from "@/lib/utils";

// ── Integrity badge pill ──

const BADGE_CONFIG: Record<
  IntegrityBadge,
  { label: string; icon: string; cls: string }
> = {
  likely: {
    label: "Likely",
    icon: "✓",
    cls: "bg-green-100 text-green-700 dark:bg-green-500/20",
  },
  uncertain: {
    label: "Uncertain",
    icon: "⚠",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/20",
  },
  unlikely: {
    label: "Unlikely",
    icon: "✗",
    cls: "bg-red-100 text-red-700 dark:bg-red-500/20",
  },
  unreadable: {
    label: "Unreadable",
    icon: "？",
    cls: "bg-gray-100 text-gray-600 dark:bg-gray-500/20",
  },
};

function IntegrityBadgePill({
  badge,
  subtle,
}: {
  badge: IntegrityBadge;
  subtle?: boolean;
}) {
  const cfg = BADGE_CONFIG[badge];
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

function IntegrityBadge({ overview }: { overview: IntegrityOverview | null }) {
  if (!overview) return null;
  if (overview.overall_status !== "complete" || !overview.overall_badge) {
    const progress = `${overview.complete_count}/${overview.problem_count}`;
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500 dark:bg-gray-500/20">
        {overview.complete_count === 0 ? "Pending" : `In progress ${progress}`}
      </span>
    );
  }
  return <IntegrityBadgePill badge={overview.overall_badge} />;
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
        {data && data.overall_badge && (
          <OverallHeaderBadge
            badge={data.overall_badge}
            confidence={data.overall_confidence}
          />
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
  badge,
  confidence,
}: {
  badge: IntegrityBadge;
  confidence: number | null;
}) {
  const cfg = BADGE_CONFIG[badge];
  return (
    <span
      className={cn("ml-auto rounded-full px-2 py-0.5 text-xs font-bold", cfg.cls)}
    >
      {cfg.icon} {cfg.label}
      {confidence != null && (
        <span className="ml-1 font-normal">
          · {Math.round(confidence * 100)}%
        </span>
      )}
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
          {p.badge && !isDismissed && (
            <IntegrityBadgePill badge={p.badge} />
          )}
          {p.confidence !== null && !isDismissed && (
            <span className="text-xs text-text-muted">
              {Math.round(p.confidence * 100)}%
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
      .listAssignmentSubmissions(assignmentId)
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
                    <IntegrityBadge overview={r.integrity_overview} />
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
