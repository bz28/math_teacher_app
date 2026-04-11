"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ── Inline typography helpers (exported for demo data files) ──

/** Upright math span, matching the real app (no italics). */
export function M({ children }: { children: ReactNode }) {
  return (
    <span className="font-medium text-[color:var(--color-text)]">
      {children}
    </span>
  );
}

/** Bold concept callout (real app uses bold for key terms inline). */
export function C({ children }: { children: ReactNode }) {
  return (
    <strong className="font-semibold text-[color:var(--color-text)]">
      {children}
    </strong>
  );
}

// ── Types ──

export type AskAQuestion = {
  /** What the student types into "Ask a question..." */
  student: string;
  /** The tutor response rendered below the question bubble */
  tutor: ReactNode;
};

export type AnimatedStep = {
  title: string;
  body: ReactNode;
  /** Optional ask-a-question interaction shown on this step */
  question?: AskAQuestion;
};

export type StepsAnimationData = {
  problem: ReactNode;
  /** Final answer shown on the solved screen */
  answer: ReactNode;
  steps: AnimatedStep[];
};

// ── Timings ──
const DEFAULT_STEP_DWELL_MS = 6500;
const QUESTION_STEP_DWELL_MS = 12000; // longer when the step has a student question
const SOLVED_DWELL_MS = 4500;
const RESET_DELAY_MS = 700;
const FIRST_STEP_DELAY_MS = 800;
/** How long after the step body fades in before the cursor starts (no-question case). */
const CURSOR_START_DELAY_MS = 500;
/** Fixed duration of the cursor animation, regardless of step dwell. */
const CURSOR_ANIMATION_MS = 3500;

function dwellFor(step: AnimatedStep, hideQuestions: boolean): number {
  if (hideQuestions) return DEFAULT_STEP_DWELL_MS;
  return step.question ? QUESTION_STEP_DWELL_MS : DEFAULT_STEP_DWELL_MS;
}

export function StepsAnimation({
  data,
  hideQuestions = false,
}: {
  data: StepsAnimationData;
  /** If true, ask-a-question interactions are skipped (used on the homepage hero). */
  hideQuestions?: boolean;
}) {
  const { problem, answer, steps } = data;
  const [phase, setPhase] = useState<"solving" | "solved">("solving");
  const [currentStep, setCurrentStep] = useState(0);

  /**
   * Which step index the cursor animation is currently ready for, or
   * `null` if not ready. Stored as an index (rather than a boolean)
   * so the parent doesn't need a synchronous reset on step change —
   * `cursorReady` is derived via `cursorReadyForStep === currentStep`,
   * and stale values from the previous step naturally compare false.
   *
   * For steps without a question (or when `hideQuestions` is true) the
   * cursor becomes ready after a short delay so the body has time to
   * fade in. For steps WITH a question, the cursor stays hidden until
   * `QuestionInteraction` signals that the tutor reply has popped in by
   * calling `onComplete`. This keeps the cursor animation decoupled
   * from the step's total dwell time and the question's internal
   * timing.
   */
  const [cursorReadyForStep, setCursorReadyForStep] = useState<number | null>(
    null,
  );
  const cursorReady = cursorReadyForStep === currentStep;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      while (!cancelled) {
        setPhase("solving");
        setCurrentStep(0);
        await wait(FIRST_STEP_DELAY_MS);
        if (cancelled) return;

        for (let i = 0; i < steps.length; i++) {
          setCurrentStep(i);
          await wait(dwellFor(steps[i], hideQuestions));
          if (cancelled) return;
        }

        setPhase("solved");
        await wait(SOLVED_DWELL_MS);
        if (cancelled) return;

        await wait(RESET_DELAY_MS);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [steps, hideQuestions]);

  // Schedule the cursor for steps that don't have a question interaction
  // to wait for. No synchronous reset is needed — stale `cursorReadyForStep`
  // values from the previous step compare false against the new `currentStep`.
  useEffect(() => {
    if (phase !== "solving") return;
    const step = steps[currentStep];
    if (!step) return;
    const hasQuestion = step.question && !hideQuestions;
    if (hasQuestion) {
      // QuestionInteraction will call handleQuestionComplete when ready.
      return;
    }
    const t = setTimeout(
      () => setCursorReadyForStep(currentStep),
      CURSOR_START_DELAY_MS,
    );
    return () => clearTimeout(t);
  }, [currentStep, phase, steps, hideQuestions]);

  const handleQuestionComplete = useCallback(() => {
    setCursorReadyForStep(currentStep);
  }, [currentStep]);

  const totalSteps = steps.length;
  const displayedStepIndex =
    phase === "solved" ? totalSteps - 1 : currentStep;
  const progressPct =
    phase === "solved"
      ? 100
      : ((displayedStepIndex + 1) / totalSteps) * 100;

  return (
    /* data-subject="math" forces the brand purple scope inside the
       animation, so physics/chemistry pages don't bleed their subject
       color into the step cards, tutor bubbles, etc. — matching how
       the real app keeps the solve UI purple regardless of subject.

       aria-hidden: the whole thing is a decorative auto-cycling demo
       with fake buttons, mock cursor clicks, and text that's already
       covered by the surrounding headline + body copy. Screen readers
       skip it instead of announcing every rotated step + fake CTA. */
    <div
      className="relative"
      data-subject="math"
      aria-hidden="true"
    >
      {/* Gradient halo */}
      <div className="pointer-events-none absolute -inset-10 -z-10 bg-gradient-to-br from-[color:var(--color-primary)]/20 via-[color:var(--color-primary-light)]/10 to-transparent blur-3xl" />

      <div className="overflow-hidden rounded-3xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] shadow-xl">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] px-5 py-3">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
          </div>
          <span className="ml-2 font-mono text-[11px] text-[color:var(--color-text-muted)]">
            veradicai.com / learn
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-primary)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--color-primary)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--color-primary)]" />
            </span>
            Live
          </span>
        </div>

        <div className="p-5 md:p-6">
          {/* Problem header */}
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-text-muted)]">
            Problem
          </p>
          <h3 className="mt-1 text-lg font-bold text-[color:var(--color-text)] md:text-xl">
            {problem}
          </h3>

          {/* Progress bar */}
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-text-muted)]">
              <span>
                Step {Math.min(displayedStepIndex + 1, totalSteps)} of{" "}
                {totalSteps}
              </span>
              {phase === "solved" && (
                <span className="text-[color:var(--color-success)]">
                  Solved ✓
                </span>
              )}
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-[color:var(--color-border-light)]">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-[color:var(--color-primary)] to-[color:var(--color-primary-light)]"
                initial={false}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>

          {/* Steps area */}
          <div className="mt-5 space-y-2.5">
            {phase === "solving" ? (
              <AnimatePresence initial={false}>
                {steps.slice(0, currentStep + 1).map((step, i) => {
                  const isCurrent = i === currentStep;
                  return (
                    <motion.div
                      key={`step-${i}`}
                      layout
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        layout: {
                          duration: 0.6,
                          ease: [0.22, 1, 0.36, 1],
                        },
                        default: {
                          duration: 0.45,
                          ease: [0.22, 1, 0.36, 1],
                        },
                      }}
                      className={
                        (isCurrent
                          ? "relative rounded-xl border border-[color:var(--color-primary)]/30 bg-[color:var(--color-primary)]/10 p-4"
                          : "flex items-center gap-3 rounded-lg border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] px-3 py-2") +
                        " transition-colors duration-500"
                      }
                    >
                      {isCurrent ? (
                        /* Expanded step */
                        <>
                          <div className="flex items-start gap-3">
                            <StepBadge index={i + 1} />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-[color:var(--color-primary)]">
                                Step {i + 1}
                                <span className="mx-1.5 text-[color:var(--color-text-muted)]">
                                  —
                                </span>
                                <span className="text-[color:var(--color-text)]">
                                  {step.title}
                                </span>
                              </p>

                              <AnimatePresence initial={false}>
                                <motion.div
                                  key="body"
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{
                                    height: {
                                      duration: 0.5,
                                      ease: [0.22, 1, 0.36, 1],
                                    },
                                    opacity: { duration: 0.3 },
                                  }}
                                  className="overflow-hidden"
                                >
                                  <div className="mt-2 text-[13px] leading-relaxed text-[color:var(--color-text-secondary)]">
                                    {step.body}
                                  </div>
                                </motion.div>
                              </AnimatePresence>

                              {/* Ask-a-question interaction (skipped when hideQuestions) */}
                              {step.question && !hideQuestions && (
                                <QuestionInteraction
                                  question={step.question}
                                  onComplete={handleQuestionComplete}
                                />
                              )}
                            </div>
                          </div>

                          {/* Ask question + I Understand row */}
                          <div className="mt-4 flex items-center gap-2 border-t border-[color:var(--color-border-light)] pt-3">
                            <div className="flex flex-1 items-center gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5">
                              <svg
                                className="h-3 w-3 text-[color:var(--color-text-muted)]"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                              </svg>
                              <span className="text-[11px] text-[color:var(--color-text-muted)]">
                                Ask a question...
                              </span>
                            </div>
                            <button
                              type="button"
                              className="rounded-lg bg-[color:var(--color-primary)] px-3 py-1.5 text-[11px] font-semibold text-white"
                              tabIndex={-1}
                            >
                              I Understand
                            </button>
                          </div>

                          {/* Animated mouse cursor moving to "I Understand".
                              Only mounts once cursorReady is true, so its
                              timing is independent of step dwell and any
                              question interaction that precedes it. */}
                          {cursorReady && <MouseCursor key={`cursor-${i}`} />}
                        </>
                      ) : (
                        /* Collapsed step */
                        <>
                          <CheckBadge />
                          <span className="flex-1 truncate text-xs font-semibold text-[color:var(--color-text-secondary)]">
                            <span className="text-[color:var(--color-success)]">
                              Step {i + 1}
                            </span>
                            <span className="mx-1.5 text-[color:var(--color-text-muted)]">
                              —
                            </span>
                            {step.title}
                          </span>
                          <svg
                            className="h-3.5 w-3.5 text-[color:var(--color-text-muted)]"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="18 15 12 9 6 15" />
                          </svg>
                        </>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            ) : (
              /* Solved screen */
              <motion.div
                key="solved"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-3"
              >
                {/* All completed steps collapsed */}
                <div className="space-y-2">
                  {steps.map((step, i) => (
                    <div
                      key={`final-${i}`}
                      className="flex items-center gap-3 rounded-lg border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] px-3 py-2"
                    >
                      <CheckBadge />
                      <span className="flex-1 truncate text-xs font-semibold text-[color:var(--color-text-secondary)]">
                        <span className="text-[color:var(--color-success)]">
                          Step {i + 1}
                        </span>
                        <span className="mx-1.5 text-[color:var(--color-text-muted)]">
                          —
                        </span>
                        {step.title}
                      </span>
                      <svg
                        className="h-3.5 w-3.5 text-[color:var(--color-text-muted)]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    </div>
                  ))}
                </div>

                {/* Answer card — green tint */}
                <div className="rounded-xl border border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/5 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-success)]">
                    Answer
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[color:var(--color-text)]">
                    {answer}
                  </p>
                </div>

                {/* Problem Solved banner */}
                <div className="rounded-xl border border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/5 p-5 text-center">
                  <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-success)]/15">
                    <svg
                      className="h-5 w-5 text-[color:var(--color-success)]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <p className="text-base font-bold text-[color:var(--color-text)]">
                    Problem Solved!
                  </p>
                  <div className="mt-4 flex flex-col gap-2">
                    <button
                      type="button"
                      tabIndex={-1}
                      className="rounded-full bg-[color:var(--color-primary)] py-2.5 text-xs font-bold text-white"
                    >
                      Try a practice problem
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning-bg)] py-2 text-xs font-semibold text-[color:var(--color-warning-dark)]"
                    >
                      <svg
                        className="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      I still have questions
                    </button>
                    <div className="flex items-center justify-center gap-4 pt-1">
                      <span className="text-[11px] font-semibold text-[color:var(--color-primary)]">
                        Learn New Problem
                      </span>
                      <span className="text-[11px] font-semibold text-[color:var(--color-primary)]">
                        Return Home
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ──

/**
 * Typewriter animation for the student's question, then a pop-in tutor
 * reply. Mounts fresh every time its parent step becomes current, so
 * typing retriggers per cycle.
 */
function QuestionInteraction({
  question,
  onComplete,
}: {
  question: AskAQuestion;
  /** Called once the tutor reply has popped in — signals the parent that
   *  the question interaction is finished and other per-step animations
   *  (like the mouse cursor) can proceed. */
  onComplete?: () => void;
}) {
  const [typedText, setTypedText] = useState("");
  const [showTutor, setShowTutor] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let typingTimer: ReturnType<typeof setInterval> | null = null;
    let tutorTimer: ReturnType<typeof setTimeout> | null = null;

    // Wait a beat after the body fades in, then start typing
    const startTimer = setTimeout(() => {
      if (cancelled) return;
      let i = 0;
      typingTimer = setInterval(() => {
        if (cancelled) return;
        i += 1;
        setTypedText(question.student.slice(0, i));
        if (i >= question.student.length) {
          if (typingTimer) clearInterval(typingTimer);
          // Pause, then pop the tutor reply in
          tutorTimer = setTimeout(() => {
            if (cancelled) return;
            setShowTutor(true);
            onComplete?.();
          }, 650);
        }
      }, 38);
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      if (typingTimer) clearInterval(typingTimer);
      if (tutorTimer) clearTimeout(tutorTimer);
    };
  }, [question.student, onComplete]);

  const isTyping = typedText.length < question.student.length;

  return (
    <div className="mt-3 space-y-2.5">
      {/* Student question bubble — right-aligned, text types in */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.75, duration: 0.3 }}
        className="flex justify-end"
      >
        <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-[color:var(--color-primary)] px-3 py-2 text-[12px] text-white">
          <span>{typedText}</span>
          {isTyping && (
            <span className="ml-0.5 inline-block h-[0.9em] w-[1.5px] translate-y-[2px] animate-pulse bg-white/90 align-middle" />
          )}
        </div>
      </motion.div>

      {/* Tutor response card — pops in after typing finishes */}
      <AnimatePresence>
        {showTutor && (
          <motion.div
            key="tutor"
            initial={{ opacity: 0, scale: 0.94, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{
              type: "spring",
              stiffness: 420,
              damping: 24,
              mass: 0.9,
            }}
            className="rounded-lg border border-[color:var(--color-primary)]/35 bg-[color:var(--color-primary)]/15 p-3"
          >
            <div className="mb-1.5 flex items-center gap-1.5">
              <div className="flex h-4 w-4 items-center justify-center rounded bg-[color:var(--color-primary)] text-[9px] font-bold text-white">
                V
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-primary)]">
                Tutor
              </span>
            </div>
            <div className="text-[12px] leading-relaxed text-[color:var(--color-text-secondary)]">
              {question.tutor}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Animated mouse cursor that moves toward the "I Understand" button,
 * simulating a click. Runs a fixed-length animation regardless of step
 * dwell — the parent mounts it when `cursorReady` is true, so its
 * start time is controlled externally (either after the body fade-in
 * for plain steps, or after the tutor reply pops in for question
 * steps).
 */
function MouseCursor() {
  return (
    <motion.div
      className="pointer-events-none absolute z-20"
      style={{ left: "22%", top: "30%" }}
      initial={{ opacity: 0, scale: 1 }}
      animate={{
        // Fixed 3.5s timeline (see CURSOR_ANIMATION_MS):
        //   0%   hidden at start position
        //   14%  faded in
        //   60%  finished gliding to the I Understand button
        //   68%  click-down pulse
        //   74%  click-up
        //   90%  fade-out complete
        opacity: [0, 0.95, 0.95, 0.95, 0.95, 0, 0],
        left: ["22%", "22%", "85%", "85%", "85%", "85%", "85%"],
        top: ["30%", "30%", "92%", "92%", "92%", "92%", "92%"],
        scale: [1, 1, 1, 0.82, 1, 1, 1],
      }}
      transition={{
        duration: CURSOR_ANIMATION_MS / 1000,
        times: [0, 0.14, 0.6, 0.68, 0.74, 0.9, 1],
        ease: "easeInOut",
      }}
    >
      <svg
        className="h-5 w-5 drop-shadow-md"
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M4 3 L4 18 L8 14 L11 21 L13 20 L10 13 L16 13 Z"
          fill="#ffffff"
          stroke="#0E0E12"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </motion.div>
  );
}

function StepBadge({ index }: { index: number }) {
  return (
    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[color:var(--color-primary)] text-xs font-bold text-white">
      {index}
    </div>
  );
}

function CheckBadge() {
  return (
    <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--color-success)]/20 text-[color:var(--color-success)]">
      <svg
        className="h-3 w-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
