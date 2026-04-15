"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  schoolStudent,
  type StudentHomeworkDetail,
  type StudentHomeworkProblem,
  type StudentSubmission,
  type VariationPayload,
} from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";
import {
  PracticeLoopSurface,
  type LoopResult,
} from "@/components/school/student/practice-loop-surface";
import { LearnLoopSurface } from "@/components/school/student/learn-loop-surface";
import { PracticeSummary } from "@/components/school/student/practice-summary";
import { SubmissionPanel } from "@/components/school/student/submission-panel";
import { SubmittedView } from "@/components/school/student/submitted-view";
import { IntegrityCheckChat } from "@/components/school/student/integrity-check-chat";
import { IntegrityPendingView } from "@/components/school/student/integrity-pending-view";

type Mode =
  | { kind: "homework" }
  | {
      kind: "practice";
      problem: StudentHomeworkProblem;
      initial: { variation: VariationPayload; consumption_id: string; remaining: number };
    }
  | {
      kind: "learn";
      problem: StudentHomeworkProblem;
      initial: { variation: VariationPayload; consumption_id: string; remaining: number };
    }
  | { kind: "summary"; problem: StudentHomeworkProblem }
  | { kind: "integrity_pending" }
  | { kind: "integrity_pending_timeout" }
  | { kind: "integrity_chat" };

export default function HomeworkPage() {
  const { courseId, assignmentId } = useParams<{ courseId: string; assignmentId: string }>();
  const [hw, setHw] = useState<StudentHomeworkDetail | null>(null);
  const [submission, setSubmission] = useState<StudentSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "homework" });
  const [loadingProblemId, setLoadingProblemId] = useState<string | null>(null);
  // Practice results live here (not in PracticeLoopSurface) so they
  // survive a Practice → Learn → Practice lens swap, which re-mounts
  // the practice surface and would otherwise wipe local state.
  const [practiceResults, setPracticeResults] = useState<LoopResult[]>([]);

  // Load (or re-load) the homework + submission + integrity state.
  // Called on mount, after submit, and after the chat finishes so
  // the entry prompt visibility / progress indicator stay in sync.
  async function loadAll(aid: string) {
    try {
      const detail = await schoolStudent.homeworkDetail(aid);
      setHw(detail);
      if (detail.submitted && detail.submission_id) {
        const [sub, integrity] = await Promise.all([
          schoolStudent.getMySubmission(aid).catch(() => null),
          schoolStudent.getIntegrityState(detail.submission_id).catch(() => null),
        ]);
        if (sub) setSubmission(sub);
        if (integrity) {
          // Auto-route based on integrity state:
          //   "extracting"       → show the preparing screen + poll
          //   "awaiting_student" / "in_progress" → open the chat
          //   "complete" / "skipped_unreadable" / "no_check"
          //                      → stay on homework view
          if (integrity.overall_status === "extracting") {
            setMode({ kind: "integrity_pending" });
          } else if (
            integrity.overall_status === "awaiting_student" ||
            integrity.overall_status === "in_progress"
          ) {
            setMode({ kind: "integrity_chat" });
          }
        }
      }
    } catch {
      setError("Couldn't load this homework. Please try again.");
    }
  }

  useEffect(() => {
    if (!assignmentId) return;
    loadAll(assignmentId);
  }, [assignmentId]);

  function appendResult(r: LoopResult) {
    setPracticeResults((rs) => [...rs, r]);
  }

  function updateResult(consumptionId: string, patch: Partial<LoopResult>) {
    setPracticeResults((rs) =>
      rs.map((r) => (r.consumption_id === consumptionId ? { ...r, ...patch } : r)),
    );
  }

  async function startLoop(problem: StudentHomeworkProblem, kind: "practice" | "learn") {
    if (!assignmentId) return;
    setLoadingProblemId(problem.bank_item_id);
    try {
      const resp = await schoolStudent.nextVariation(assignmentId, problem.bank_item_id, kind);
      if (resp.status === "served") {
        // Fresh entry from the HW page = new loop session, so reset
        // any prior practice results from a previous problem.
        setPracticeResults([]);
        setMode({
          kind,
          problem,
          initial: {
            variation: resp.variation,
            consumption_id: resp.consumption_id,
            remaining: resp.remaining,
          },
        });
      } else if (resp.status === "exhausted") {
        setError(
          "You've practiced everything available for this problem — ask your teacher for more.",
        );
      } else {
        setError("No practice problems are available for this one yet.");
      }
    } catch {
      setError("Couldn't load a practice problem. Please try again.");
    } finally {
      setLoadingProblemId(null);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <p className="text-error">{error}</p>
        <button
          onClick={() => setError(null)}
          className="mt-4 rounded-[--radius-sm] border border-border px-4 py-2 text-sm hover:border-primary"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (hw === null) {
    return <div className="mx-auto max-w-2xl py-12 text-center text-text-muted">Loading…</div>;
  }

  if (mode.kind === "practice") {
    return (
      <PracticeLoopSurface
        assignmentId={hw.assignment_id}
        anchorBankItemId={mode.problem.bank_item_id}
        problemPosition={mode.problem.position}
        initial={mode.initial}
        results={practiceResults}
        onAppendResult={appendResult}
        onUpdateResult={updateResult}
        onDone={() => setMode({ kind: "summary", problem: mode.problem })}
        onExit={() => setMode({ kind: "homework" })}
        onSwitchToLearn={(state) =>
          setMode({ kind: "learn", problem: mode.problem, initial: state })
        }
      />
    );
  }

  if (mode.kind === "learn") {
    return (
      <LearnLoopSurface
        assignmentId={hw.assignment_id}
        anchorBankItemId={mode.problem.bank_item_id}
        problemPosition={mode.problem.position}
        initial={mode.initial}
        onDone={() => setMode({ kind: "homework" })}
        onExit={() => setMode({ kind: "homework" })}
        onSwitchToPractice={(state) =>
          setMode({ kind: "practice", problem: mode.problem, initial: state })
        }
      />
    );
  }

  if (mode.kind === "summary") {
    return (
      <PracticeSummary
        assignmentId={hw.assignment_id}
        anchorBankItemId={mode.problem.bank_item_id}
        problemPosition={mode.problem.position}
        results={practiceResults}
        onBackToHomework={() => setMode({ kind: "homework" })}
      />
    );
  }

  if (mode.kind === "integrity_pending" && hw.submission_id) {
    return (
      <IntegrityPendingView
        submissionId={hw.submission_id}
        onReady={async () => {
          // Re-fetch state and let loadAll decide where to route
          // next (chat, submitted view, etc.).
          if (assignmentId) await loadAll(assignmentId);
        }}
        onTimeout={() => setMode({ kind: "integrity_pending_timeout" })}
      />
    );
  }

  if (mode.kind === "integrity_pending_timeout") {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <h1 className="text-2xl font-bold text-text-primary">
          Couldn&apos;t prepare your check
        </h1>
        <p className="mt-3 text-sm text-text-secondary">
          Your homework submission was saved successfully — your teacher has
          it. Refresh the page to try again.
        </p>
        <button
          onClick={() => {
            if (assignmentId) {
              setMode({ kind: "homework" });
              loadAll(assignmentId);
            }
          }}
          className="mt-6 rounded-[--radius-sm] bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary/90"
        >
          Refresh
        </button>
      </div>
    );
  }

  if (mode.kind === "integrity_chat" && hw.submission_id) {
    return (
      <IntegrityCheckChat
        submissionId={hw.submission_id}
        onDone={async () => {
          setMode({ kind: "homework" });
          if (assignmentId) await loadAll(assignmentId);
        }}
      />
    );
  }

  // mode.kind === "homework"
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/school/student/courses/${courseId}`}
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary"
      >
        ← Back to homework list
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">{hw.title}</h1>
      <p className="mt-1 text-sm text-text-secondary">
        {hw.problems.length} {hw.problems.length === 1 ? "problem" : "problems"}
        {hw.due_at ? ` · Due ${new Date(hw.due_at).toLocaleDateString()}` : ""}
      </p>

      <div className="mt-6 space-y-4">
        {hw.problems.map((p) => {
          const noVariations = p.approved_variation_count === 0;
          const isLoading = loadingProblemId === p.bank_item_id;
          return (
            <div
              key={p.bank_item_id}
              className="rounded-[--radius-md] border border-border bg-surface p-6"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-bg text-sm font-bold text-primary">
                  {p.position}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 text-base text-text-primary">
                      <MathText text={p.question} />
                    </div>
                    <span
                      title="This is your homework — practice similar problems below to learn it."
                      className="shrink-0 text-text-muted"
                    >
                      <LockIcon />
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => startLoop(p, "practice")}
                      disabled={noVariations || isLoading}
                      className={cn(
                        "rounded-[--radius-sm] bg-primary px-4 py-1.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50",
                      )}
                    >
                      {isLoading ? "Loading…" : "Practice similar"}
                    </button>
                    <button
                      onClick={() => startLoop(p, "learn")}
                      disabled={noVariations || isLoading}
                      className={cn(
                        "rounded-[--radius-sm] border border-border px-4 py-1.5 text-sm font-medium text-text-secondary hover:border-primary hover:text-primary disabled:opacity-50",
                      )}
                    >
                      Learn similar
                    </button>
                    <span className="ml-auto text-xs font-medium text-text-muted">
                      {noVariations
                        ? "No practice available yet"
                        : `${p.approved_variation_count} practice ${
                            p.approved_variation_count === 1 ? "problem" : "problems"
                          } available`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {hw.submitted && submission ? (
        <SubmittedView submission={submission} />
      ) : !hw.submitted ? (
        <SubmissionPanel
          assignmentId={hw.assignment_id}
          dueAt={hw.due_at}
          onSubmitted={async (_resp) => {
            // Re-fetch everything (detail + submission + integrity
            // state) in one helper so the UI swaps to the
            // SubmittedView and the integrity entry prompt appears
            // in the same render.
            await loadAll(hw.assignment_id);
          }}
        />
      ) : null}
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}
