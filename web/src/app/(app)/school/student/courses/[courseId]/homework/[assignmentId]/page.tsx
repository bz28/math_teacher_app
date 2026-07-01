"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  schoolStudent,
  EntitlementError,
  type StudentHomeworkDetail,
  type StudentProblemFeedback,
  type StudentSubmission,
  type SubmissionFile,
} from "@/lib/api";
import { usePracticeStore } from "@/stores/practice";
import { useSessionStore, type Subject } from "@/stores/learn";
import { FigureDisplay } from "@/components/shared/figure-display";
import { MathText } from "@/components/shared/math-text";
import { PageErrorState } from "@/components/ui";
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
      files: SubmissionFile[];
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
  // Post-publish view filter — flips the problems list to show only
  // partial/zero rows. Default off so the student lands on the
  // complete record; flipping the toggle is the "go fix what I got
  // wrong" mode. Page-level state so the toggle survives a re-fetch
  // (visibility-change re-loads keep the filter intact).
  const [missedOnly, setMissedOnly] = useState(false);

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
          sub.files != null &&
          sub.files.length > 0 &&
          !confirmedThisSession
        ) {
          setMode({
            kind: "integrity_confirm",
            extraction: sub.extraction,
            files: sub.files,
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
          //   "complete" / "skipped_unreadable"
          //                      → chat, so the student can review the
          //                        finished conversation and see its
          //                        closing verdict (the chat renders a
          //                        read-only completion panel once the
          //                        check is done — no live input box).
          //   "no_check"         → stay on homework view
          if (integrity.overall_status === "extracting") {
            setMode({ kind: "integrity_pending" });
          } else if (
            integrity.overall_status === "awaiting_student"
            || integrity.overall_status === "in_progress"
            || integrity.overall_status === "complete"
            || integrity.overall_status === "skipped_unreadable"
          ) {
            setMode({ kind: "integrity_chat" });
          }
        }
      }
    } catch {
      setError("We couldn't load this homework right now.");
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
      <PageErrorState
        message={error}
        onRetry={() => {
          if (!assignmentId) return;
          setError(null);
          loadAll(assignmentId);
        }}
      />
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
        submittedFiles={mode.files}
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
        assignmentId={hw.assignment_id}
        courseId={courseId}
        onDone={async () => {
          setMode({ kind: "homework" });
          if (assignmentId) await loadAll(assignmentId);
        }}
      />
    );
  }

  // mode.kind === "homework"
  // Course subject coerced to the practice/learn engines' Subject union
  // (course.subject is constrained to these three server-side; fall back
  // to math defensively).
  const subject: Subject =
    hw.course_subject === "physics" || hw.course_subject === "chemistry"
      ? hw.course_subject
      : "math";
  // Question text of every missed (partial/zero) problem, resolved from
  // the grade breakdown back to the problem stem. Drops any entry whose
  // text isn't recoverable (deleted ref / empty stem) so the "practice
  // everything I missed" CTA never seeds the engine with a blank stem.
  const missedProblemTexts = (hw.breakdown ?? [])
    .filter((b) => b.score_status !== "full")
    .map((b) => hw.problems.find((p) => p.bank_item_id === b.problem_id)?.question)
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0);

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

      {/* Teacher-authored instructions, e.g. "Show all work, no
          calculators." Hidden when there's nothing to say. Renders LaTeX
          inline so formulas in the instructions display correctly. */}
      {hw.description && (
        <div className="mt-4 rounded-[--radius-md] border border-border bg-bg-subtle/40 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Instructions
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-text-primary">
            <MathText text={hw.description} />
          </div>
        </div>
      )}

      <div className="mt-5">
        <AssignmentTimeline
          submittedAt={hw.submitted_at}
          finalScore={hw.final_score}
          gradePublishedAt={hw.grade_published_at}
        />
      </div>

      {/* Post-publish hero — once the teacher publishes a grade, the
          student's first question is "what'd I get and what should I
          look at?" The hero answers both with a big score, a single
          you-got-X-of-Y line, and a "show only what I missed" toggle
          that filters the problems list below. Hidden pre-publish
          where the timeline / submission flow is still the right
          focus. */}
      {hw.grade_published_at !== null && hw.breakdown && hw.breakdown.length > 0 && (
        <GradedSummaryCard
          finalScore={hw.final_score}
          breakdown={hw.breakdown}
          missedOnly={missedOnly}
          onMissedOnlyChange={setMissedOnly}
          missedProblemTexts={missedProblemTexts}
          subject={subject}
        />
      )}

      <div className="mt-6 space-y-4">
        {hw.problems
          // Filter only when the toggle's on AND grades are published
          // (no published grade = nothing to filter against; falling
          // through to show all keeps the page coherent on the rare
          // mid-publish race).
          .filter((p) => {
            if (!missedOnly) return true;
            if (!hw.breakdown) return true;
            const entry = hw.breakdown.find((b) => b.problem_id === p.bank_item_id);
            if (!entry) return true;
            return entry.score_status !== "full";
          })
          .map((p) => {
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
                    {/* Geometry figure when present — rendered above
                        the question text since most setups read
                        "figure first, then prose referencing it." */}
                    <FigureDisplay
                      svg={p.figure_svg}
                      ariaLabel={`Figure for problem ${p.position}`}
                    />
                    <div className="text-base text-text-primary">
                      <MathText text={p.question} />
                    </div>

                    {/* MCQ choices laid out beneath the problem so the
                        student knows which letter to circle on their
                        handwritten work. Submission is still the
                        photo-upload flow — these are display-only. */}
                    {p.format === "mcq" && p.mcq_choices.length === 4 && (
                      <ol className="mt-3 space-y-1 pl-1 text-sm text-text-primary">
                        {p.mcq_choices.map((choice, i) => (
                          <li
                            key={`${p.bank_item_id}-${i}`}
                            className="flex items-start gap-2"
                          >
                            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-bold text-text-muted">
                              {String.fromCharCode(65 + i)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <MathText text={choice} />
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}

                    {gradeEntry !== null && (
                      <PublishedGradePanel entry={gradeEntry} />
                    )}

                    {/* Post-grade remediation — the highest-intent
                        moment to route a missed problem into practice or
                        a guided walkthrough. Only on missed problems
                        (full credit needs no fix) with a recoverable
                        stem (skip blanks / unreadable). */}
                    {gradeEntry !== null &&
                      gradeEntry.score_status !== "full" &&
                      p.question.trim() !== "" && (
                        <RemediationActions
                          problemTexts={[p.question]}
                          subject={subject}
                        />
                      )}
                  </div>
                </div>
              </div>
            );
          })}
        {missedOnly &&
          hw.breakdown &&
          hw.breakdown.every((b) => b.score_status === "full") && (
            <div className="rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle/40 p-8 text-center">
              <p className="text-sm font-bold text-text-primary">
                Nothing missed — full credit on every problem.
              </p>
              <button
                type="button"
                onClick={() => setMissedOnly(false)}
                className="mt-2 text-xs font-semibold text-primary hover:underline"
              >
                Show all problems
              </button>
            </div>
          )}
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
 * Hero card that lands the post-publish moment: the headline percent,
 * a one-line per-problem breakdown the student can scan in 2 seconds,
 * and a one-click filter to focus on what they got wrong. Only renders
 * when the teacher has published a grade with a per-problem breakdown
 * — pre-publish, the AssignmentTimeline above carries the journey.
 */
function GradedSummaryCard({
  finalScore,
  breakdown,
  missedOnly,
  onMissedOnlyChange,
  missedProblemTexts,
  subject,
}: {
  finalScore: number | null;
  breakdown: StudentProblemFeedback[];
  missedOnly: boolean;
  onMissedOnlyChange: (next: boolean) => void;
  /** Recoverable question texts of the missed problems — feeds the
   *  "practice everything I missed" CTA. May be shorter than `missed`
   *  if some stems weren't recoverable. */
  missedProblemTexts: string[];
  subject: Subject;
}) {
  const total = breakdown.length;
  const full = breakdown.filter((b) => b.score_status === "full").length;
  const partial = breakdown.filter((b) => b.score_status === "partial").length;
  const zero = breakdown.filter((b) => b.score_status === "zero").length;
  const missed = partial + zero;
  // Same tone scale as the My Grades headline / individual rows. One
  // source of truth for "what counts as a strong grade" so the
  // headline number's color matches what the rows below show.
  const scoreTone =
    finalScore === null
      ? "text-text-primary"
      : finalScore >= 85
        ? "text-green-700 dark:text-green-400"
        : finalScore >= 70
          ? "text-amber-700 dark:text-amber-400"
          : "text-red-700 dark:text-red-400";
  return (
    <div className="mt-5 rounded-[--radius-xl] border border-border-light bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Your score
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-5xl font-extrabold tabular-nums ${scoreTone}`}>
              {finalScore !== null ? Math.round(finalScore) : "—"}
            </span>
            <span className="text-2xl font-semibold text-text-muted">%</span>
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            <span className="font-semibold text-text-primary">{full}</span> of{" "}
            {total} full credit
            {partial > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  {partial} partial
                </span>
              </>
            )}
            {zero > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-red-700 dark:text-red-400">
                  {zero} missed
                </span>
              </>
            )}
          </p>
        </div>
        {missed > 0 && (
          <button
            type="button"
            onClick={() => onMissedOnlyChange(!missedOnly)}
            aria-pressed={missedOnly}
            className={`shrink-0 rounded-[--radius-md] border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              missedOnly
                ? "border-primary bg-primary text-white hover:bg-primary-dark"
                : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-primary"
            }`}
          >
            {missedOnly
              ? `Showing ${missed} ${missed === 1 ? "problem" : "problems"} you missed · Show all`
              : `Show only what I missed (${missed})`}
          </button>
        )}
      </div>

      {/* One-tap remediation for the whole set of misses — the
          post-grade moment is the highest-intent point to route the
          student into practice. Hidden when no stem was recoverable. */}
      {missed > 0 && missedProblemTexts.length > 0 && (
        <RemediationActions
          problemTexts={missedProblemTexts}
          subject={subject}
          variant="primary"
          practiceLabel={`Practice everything I missed (${missedProblemTexts.length})`}
          className="mt-4 border-t border-border-light pt-4"
        />
      )}
    </div>
  );
}

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

/**
 * Post-grade remediation CTAs — turn a missed problem (or the whole set
 * of misses) into a practice batch or a guided step-by-step walkthrough.
 * Seeds the practice/learn engines with the problem stem(s) and routes
 * the student into the running session.
 *
 *   "Practice similar"     → generates look-alike problems, lands on
 *                            /practice (preview → answer).
 *   "Learn step-by-step"   → opens the guided solver, lands on
 *                            /learn/session.
 *
 * Single stem uses startPracticeBatch; multiple uses startPracticeQueue
 * (matches the existing weak-spots / history entry pattern). Subject is
 * pushed into the session store first because both engines read it from
 * there.
 */
function RemediationActions({
  problemTexts,
  subject,
  variant = "compact",
  practiceLabel = "Practice similar",
  className = "",
}: {
  problemTexts: string[];
  subject: Subject;
  variant?: "compact" | "primary";
  practiceLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const setSubject = useSessionStore((s) => s.setSubject);
  const startLearnQueue = useSessionStore((s) => s.startLearnQueue);
  const startPracticeBatch = usePracticeStore((s) => s.startPracticeBatch);
  const startPracticeQueue = usePracticeStore((s) => s.startPracticeQueue);
  const [pending, setPending] = useState<null | "practice" | "learn">(null);

  if (problemTexts.length === 0) return null;

  async function launch(
    kind: "practice" | "learn",
    start: () => Promise<void>,
    dest: string,
  ) {
    if (pending) return;
    setSubject(subject); // both engines read subject from the session store
    setPending(kind);
    try {
      await start();
      router.push(dest);
      // Leave `pending` set — the route push unmounts this component, so
      // the button stays in its "Starting…" state until navigation.
    } catch (err) {
      if (err instanceof EntitlementError) {
        router.push("/pricing");
        return;
      }
      // start() routes its own failures into the store's error phase;
      // anything thrown here just resets the button so it's retryable.
      setPending(null);
    }
  }

  const onPractice = () =>
    launch(
      "practice",
      () =>
        problemTexts.length === 1
          ? startPracticeBatch(problemTexts[0], subject)
          : startPracticeQueue(problemTexts, subject),
      "/practice",
    );
  const onLearn = () =>
    launch(
      "learn",
      () => startLearnQueue(problemTexts),
      `/learn/session?subject=${subject}`,
    );

  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-[--radius-md] border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60";
  const size = variant === "primary" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs";
  const primaryBtn = "border-primary bg-primary text-white hover:bg-primary-dark";
  const ghostBtn =
    "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-primary";

  return (
    <div className={`flex flex-wrap gap-2 ${variant === "compact" ? "mt-3" : ""} ${className}`}>
      <button
        type="button"
        onClick={onPractice}
        disabled={pending !== null}
        className={`${base} ${size} ${primaryBtn}`}
      >
        {pending === "practice" ? "Starting…" : practiceLabel}
      </button>
      <button
        type="button"
        onClick={onLearn}
        disabled={pending !== null}
        className={`${base} ${size} ${ghostBtn}`}
      >
        {pending === "learn" ? "Starting…" : "Learn step-by-step"}
      </button>
    </div>
  );
}
