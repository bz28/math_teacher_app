"use client";

import { useEffect, useState } from "react";
import {
  teacher,
  type IntegrityOverview,
  type TeacherIntegrityDetail,
  type TeacherIntegrityProblemRow,
  type TeacherSubmissionDetail,
  type TeacherSubmissionRow,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Integrity badge pill ──

const BADGE_CONFIG = {
  likely: { label: "Likely", icon: "✓", cls: "bg-green-100 text-green-700 dark:bg-green-500/20" },
  uncertain: { label: "Uncertain", icon: "⚠", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/20" },
  unlikely: { label: "Unlikely", icon: "✗", cls: "bg-red-100 text-red-700 dark:bg-red-500/20" },
} as const;

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
  const cfg = BADGE_CONFIG[overview.overall_badge];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", cfg.cls)}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ── Verdict pill for individual Q&A rows ──

const VERDICT_CONFIG: Record<string, { label: string; cls: string }> = {
  good: { label: "Good", cls: "text-green-600" },
  weak: { label: "Weak", cls: "text-amber-600" },
  bad: { label: "Bad", cls: "text-red-600" },
  skipped: { label: "Skipped", cls: "text-gray-400" },
  rephrased: { label: "Rephrased", cls: "text-blue-500" },
};

// ── Integrity detail section (expandable inside submission detail) ──

function IntegritySection({ submissionId }: { submissionId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TeacherIntegrityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    if (next && !data && !loading) load();
  }

  async function dismiss(problemId: string) {
    setDismissingId(problemId);
    try {
      await teacher.dismissIntegrityProblem(submissionId, problemId, dismissReason);
      // Refresh data after dismiss
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
    <div className="space-y-2">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-2 text-sm font-semibold text-text-primary hover:text-primary"
      >
        <span className="text-xs">{open ? "▼" : "▶"}</span>
        Understanding Check
        {data && data.overall_status === "complete" && data.problems.length > 0 && (
          <OverallBadgePill problems={data.problems} />
        )}
      </button>

      {open && loading && <p className="text-xs text-text-muted">Loading…</p>}
      {open && error && <p className="text-xs text-error">{error}</p>}

      {open && data && (
        <>
          {data.overall_status === "no_check" && (
            <p className="text-xs text-text-muted">No integrity check for this submission.</p>
          )}
          {data.problems.length === 0 && data.overall_status !== "no_check" && (
            <p className="text-xs text-text-muted">Waiting for student to complete the check.</p>
          )}
          {data.problems.map((p) => (
            <ProblemCard
              key={p.problem_id}
              problem={p}
              dismissConfirm={dismissConfirm}
              dismissReason={dismissReason}
              dismissingId={dismissingId}
              onStartDismiss={(id) => { setDismissConfirm(id); setDismissReason(""); }}
              onCancelDismiss={() => setDismissConfirm(null)}
              onDismiss={dismiss}
              onDismissReasonChange={setDismissReason}
            />
          ))}
        </>
      )}
    </div>
  );
}

function OverallBadgePill({ problems }: { problems: TeacherIntegrityProblemRow[] }) {
  const badges = problems.filter((p) => p.badge && !p.teacher_dismissed).map((p) => p.badge!);
  if (badges.length === 0) return null;
  let worst: "likely" | "uncertain" | "unlikely" = "likely";
  if (badges.includes("unlikely")) worst = "unlikely";
  else if (badges.includes("uncertain")) worst = "uncertain";
  const cfg = BADGE_CONFIG[worst];
  return (
    <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs font-bold", cfg.cls)}>
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
  const badge = p.badge ? BADGE_CONFIG[p.badge as keyof typeof BADGE_CONFIG] : null;
  const isDismissed = p.teacher_dismissed;

  return (
    <div
      className={cn(
        "rounded-[--radius-sm] border p-3 space-y-2",
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
          {badge && !isDismissed && (
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", badge.cls)}>
              {badge.icon} {badge.label}
            </span>
          )}
          {p.raw_score !== null && !isDismissed && (
            <span className="text-xs text-text-muted">
              ({Math.round(p.raw_score * 100)}%)
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

      {/* Q&A rows */}
      {!isDismissed && p.responses.length > 0 && (
        <div className="space-y-1.5">
          {p.responses.map((r) => {
            const verdict = r.answer_verdict ? VERDICT_CONFIG[r.answer_verdict] : null;
            return (
              <div key={r.response_id} className="rounded-[--radius-sm] bg-background p-2 text-xs">
                <div className="font-medium text-text-primary">Q: {r.question_text}</div>
                {r.student_answer ? (
                  <div className="mt-0.5 text-text-secondary">A: {r.student_answer}</div>
                ) : (
                  <div className="mt-0.5 italic text-text-muted">No answer yet</div>
                )}
                <div className="mt-1 flex items-center gap-3 text-text-muted">
                  {verdict && (
                    <span className={cn("font-semibold", verdict.cls)}>{verdict.label}</span>
                  )}
                  {r.seconds_on_question !== null && (
                    <span>{r.seconds_on_question}s</span>
                  )}
                  {r.tab_switch_count > 0 && (
                    <span className="text-amber-600">{r.tab_switch_count} tab switch{r.tab_switch_count > 1 ? "es" : ""}</span>
                  )}
                  {r.rephrase_used && (
                    <span className="text-blue-500">Rephrased</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dismiss action */}
      {!isDismissed && p.status === "complete" && (
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

// ── Main panel ──

interface Props {
  assignmentId: string;
  onClose: () => void;
}

/**
 * Modal that lists all submissions for a homework, with a click-to-
 * expand per-submission detail subview. Wired up from the
 * `⚙ Submissions` button in homework-detail-modal.tsx (was a
 * placeholder; now a real view).
 *
 * No grading or annotations in this PR — just "here's what they
 * turned in." Reuses the existing list endpoint
 * `/v1/teacher/assignments/{id}/submissions` and the new detail
 * endpoint `/v1/teacher/submissions/{id}`.
 */
export function SubmissionsPanel({ assignmentId, onClose }: Props) {
  const [rows, setRows] = useState<TeacherSubmissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeacherSubmissionDetail | null>(null);
  // Derived: we're loading the detail iff a row is open, the detail
  // object hasn't arrived, AND no error has been recorded. Excluding
  // the error state prevents the spinner from getting stuck "Loading…"
  // forever next to the error message when the fetch fails.
  const detailLoading = openId !== null && detail === null && error === null;

  useEffect(() => {
    teacher
      .listAssignmentSubmissions(assignmentId)
      .then((d) => setRows(d.submissions))
      .catch(() => setError("Couldn't load submissions."));
  }, [assignmentId]);

  useEffect(() => {
    // Only fetch when transitioning into the detail view. Clearing
    // the detail when openId becomes null happens in the close-row
    // handler below — keeping the effect "fetch only" satisfies
    // the no-cascading-render rule and matches the React docs'
    // recommended pattern (https://react.dev/learn/you-might-not-need-an-effect).
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
    // z-[60] (one layer above the homework detail modal's z-50) so the
    // panel paints on top instead of behind it. Click outside the
    // dialog body closes the panel for a snappy escape.
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
            {openId && detail ? `${detail.student_name} — ${detail.assignment_title}` : "Submissions"}
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
                    <div className="text-sm font-semibold text-text-primary">
                      {r.student_name || r.student_email}
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
                <div className="text-sm font-semibold text-text-primary">Submitted work</div>
                {/* image_data is always a full data URL — the
                    SubmissionPanel keeps the prefix intact and the
                    backend's magic-byte check rejects anything that
                    isn't PNG or JPEG. */}
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
