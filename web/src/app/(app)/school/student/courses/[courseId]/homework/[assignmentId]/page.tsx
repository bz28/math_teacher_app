"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  schoolStudent,
  type StudentHomeworkDetail,
  type StudentProblemFeedback,
  type StudentSubmission,
} from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { SubmissionPanel } from "@/components/school/student/submission-panel";
import { SubmittedView } from "@/components/school/student/submitted-view";
import { IntegrityCheckChat } from "@/components/school/student/integrity-check-chat";
import { SubmissionExtractionConfirmView } from "@/components/school/student/submission-extraction-confirm-view";
import { ExtractionFlaggedTerminalView } from "@/components/school/student/extraction-flagged-terminal-view";
import { IntegrityPendingView } from "@/components/school/student/integrity-pending-view";
import { AssignmentTimeline } from "@/components/school/student/assignment-timeline";
import type { IntegrityExtraction } from "@/lib/api";

type Mode =
  | { kind: "homework" }
  | { kind: "integrity_pending" }
  | { kind: "integrity_pending_timeout" }
  | {
      kind: "integrity_confirm";
      extraction: IntegrityExtraction;
      imageDataUrl: string;
    }
  | { kind: "integrity_chat" }
  /** Student flagged "reader got something wrong" on the confirm
   *  screen. Submission is routed to the teacher for manual
   *  grading; no AI calls run. Terminal — nothing else to do. */
  | { kind: "extraction_flagged" };

export default function HomeworkPage() {
  const { courseId, assignmentId } = useParams<{ courseId: string; assignmentId: string }>();
  const [hw, setHw] = useState<StudentHomeworkDetail | null>(null);
  const [submission, setSubmission] = useState<StudentSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "homework" });
  // Client-side flag: the student clicked through the post-extraction
  // confirm screen in this session, so we should not keep shoving it
  // in their face if they come back before sending their first turn.
  // Backend has no explicit "confirmed_at" on the submission — once
  // they send a message the status flips to `in_progress` and routing
  // naturally skips the confirm branch, so this flag only covers the
  // brief window before their first turn.
  const [confirmedThisSession, setConfirmedThisSession] = useState(false);

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

        // Routing precedence (top match wins):
        //
        // 1. Flagged   — student said "reader got it wrong". Nothing
        //                downstream ran; go straight to the terminal.
        // 2. Extracting — Vision hasn't finished yet. Show the
        //                preparing spinner + poll.
        // 3. Awaiting confirm — extraction done, student hasn't
        //                pressed Confirm/Flag. Integrity + grading
        //                are gated on that press, so there's no
        //                IntegrityCheckSubmission row yet and the
        //                integrity-state endpoint can't tell us
        //                apart from "extracting". Drive this one off
        //                the submission row directly.
        // 4. Integrity state — once the student has confirmed, the
        //                existing integrity state machine takes
        //                over (pending → awaiting_student → chat).
        if (sub?.extraction_flagged_at != null) {
          setMode({ kind: "extraction_flagged" });
          return;
        }
        if (sub && sub.extraction == null) {
          // Extraction only runs when either integrity or AI grading
          // is on — if both are off, `sub.extraction` stays null
          // forever and a 90s spinner waiting for it is a bug, not a
          // wait. Fall through to the homework view and let the
          // submitted state render as normal.
          if (
            !sub.integrity_check_enabled &&
            !sub.ai_grading_enabled
          ) {
            setMode({ kind: "homework" });
            return;
          }
          // Still extracting (or extraction failed — IntegrityPendingView
          // handles the timeout fallback in that case).
          setMode({ kind: "integrity_pending" });
          return;
        }
        if (
          sub &&
          sub.extraction_confirmed_at == null &&
          sub.extraction != null &&
          sub.image_data != null &&
          !confirmedThisSession
        ) {
          setMode({
            kind: "integrity_confirm",
            extraction: sub.extraction,
            imageDataUrl: sub.image_data,
          });
          return;
        }

        if (integrity) {
          // Student has confirmed — fall through to the integrity
          // state machine. Auto-route:
          //   "extracting"       → preparing screen + poll
          //   "awaiting_student" → chat (we've already shown the
          //                         submission-level confirm above;
          //                         the integrity-sampled per-problem
          //                         confirm was collapsed into that)
          //   "in_progress"      → chat
          //   "complete" / "skipped_unreadable" / "no_check"
          //                      → stay on homework view
          if (integrity.overall_status === "extracting") {
            setMode({ kind: "integrity_pending" });
          } else if (
            integrity.overall_status === "awaiting_student"
            || integrity.overall_status === "in_progress"
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
    // loadAll intentionally reads component state via closure (mode,
    // confirmedThisSession, etc.) — adding it to deps would re-fetch
    // on every unrelated state change. Route only re-runs on route
    // change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

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

  if (mode.kind === "integrity_pending" && hw.submission_id && assignmentId) {
    return (
      <IntegrityPendingView
        submissionId={hw.submission_id}
        assignmentId={assignmentId}
        onReady={async () => {
          // Re-fetch state and let loadAll decide where to route
          // next (chat, submitted view, etc.).
          await loadAll(assignmentId);
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

  if (mode.kind === "integrity_confirm" && hw.submission_id) {
    const submissionId = hw.submission_id;
    return (
      <SubmissionExtractionConfirmView
        submissionId={submissionId}
        submittedImageDataUrl={mode.imageDataUrl}
        extraction={mode.extraction}
        onContinue={async () => {
          setConfirmedThisSession(true);
          // Re-fetch + reroute from server truth. Handles the 409
          // recovery case where the confirm endpoint bailed because
          // the submission was flagged in another tab: loadAll sees
          // extraction_flagged_at and routes to the terminal screen
          // instead of dropping the student into an empty chat.
          if (assignmentId) {
            await loadAll(assignmentId);
          } else {
            setMode({ kind: "integrity_chat" });
          }
        }}
        onFlagged={async () => {
          // Flag skips grading + integrity. Re-fetch in case the
          // server had already moved on (e.g. someone confirmed in
          // another tab) so the student lands on the right terminal.
          if (assignmentId) {
            await loadAll(assignmentId);
          } else {
            setMode({ kind: "extraction_flagged" });
          }
        }}
      />
    );
  }

  if (mode.kind === "extraction_flagged") {
    return <ExtractionFlaggedTerminalView />;
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

      <div className="mt-5">
        <AssignmentTimeline
          submittedAt={hw.submitted_at}
          finalScore={hw.final_score}
          gradePublishedAt={hw.grade_published_at}
        />
      </div>

      <div className="mt-6 space-y-4">
        {hw.problems.map((p) => {
          // Per-problem published grade entry, if the teacher has
          // published grades. Backend only sets `breakdown` once
          // grade_published_at is set, so finding an entry here is a
          // safe signal that this problem is ready to show.
          const gradeEntry =
            hw.breakdown?.find((b) => b.problem_id === p.bank_item_id) ?? null;
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
                  <div className="text-base text-text-primary">
                    <MathText text={p.question} />
                  </div>

                  {gradeEntry !== null && (
                    <PublishedGradePanel entry={gradeEntry} />
                  )}
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

const GRADE_TONE: Record<
  StudentProblemFeedback["score_status"],
  { bg: string; border: string; text: string; icon: string; label: string }
> = {
  full: {
    bg: "bg-green-50 dark:bg-green-900/20",
    border: "border-green-200 dark:border-green-900/40",
    text: "text-green-800 dark:text-green-300",
    icon: "✓",
    label: "Full credit",
  },
  partial: {
    bg: "bg-amber-50 dark:bg-amber-900/20",
    border: "border-amber-200 dark:border-amber-900/40",
    text: "text-amber-800 dark:text-amber-300",
    icon: "◐",
    label: "Partial credit",
  },
  zero: {
    bg: "bg-red-50 dark:bg-red-900/20",
    border: "border-red-200 dark:border-red-900/40",
    text: "text-red-800 dark:text-red-300",
    icon: "✗",
    label: "No credit",
  },
};

/**
 * Per-problem published-grade panel — score status + teacher/AI
 * feedback. Only renders when the teacher has published grades (the
 * backend only returns breakdown entries once grade_published_at is
 * set, so if we have an entry, the grade is safe to show).
 */
function PublishedGradePanel({ entry }: { entry: StudentProblemFeedback }) {
  const tone = GRADE_TONE[entry.score_status];
  const percent = Math.round(entry.percent);
  return (
    <div
      role="status"
      aria-label={`${tone.label}, ${percent} percent`}
      className={`mt-4 rounded-[--radius-md] border ${tone.border} ${tone.bg} px-4 py-3`}
    >
      <p className={`flex items-center gap-1.5 text-sm font-bold ${tone.text}`}>
        <span aria-hidden>{tone.icon}</span>
        {tone.label}
        <span className="font-normal text-text-muted">· {percent}%</span>
      </p>
      {entry.feedback && (
        // Published feedback often references specific steps with
        // math ($-17$, $\begin{pmatrix}...$) — render through MathText
        // so students see formatted math instead of raw LaTeX.
        <div className="mt-1.5 break-words text-sm leading-relaxed text-text-primary">
          <MathText text={entry.feedback} />
        </div>
      )}
    </div>
  );
}
