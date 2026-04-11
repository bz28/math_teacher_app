"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Step = {
  title: string;
  body: ReactNode;
};

const PROBLEM_TEXT = (
  <>
    Solve for <em className="font-serif italic">x</em>:{" "}
    <span className="font-serif italic">
      x<sup>2</sup> − 11x + 24 = 0
    </span>
  </>
);

// Inline math helper — italic serif to mimic KaTeX rendering in the real app
function M({ children }: { children: ReactNode }) {
  return <span className="font-serif italic">{children}</span>;
}
// Bolded concept callout (styled like the real app's bold inline terms)
function C({ children }: { children: ReactNode }) {
  return (
    <strong className="font-semibold text-[color:var(--color-text)]">
      {children}
    </strong>
  );
}

const steps: Step[] = [
  {
    title: "Understand the problem",
    body: (
      <>
        We have a quadratic equation{" "}
        <M>
          x<sup>2</sup> − 11x + 24 = 0
        </M>{" "}
        and need to find the values of{" "}
        <M>x</M> that make this equation true. This is a{" "}
        <C>quadratic equation</C> in standard form{" "}
        <M>
          ax<sup>2</sup> + bx + c = 0
        </M>
        . The most elegant approach here is to use <C>factoring</C>, since
        we&rsquo;re looking for two numbers that multiply to give us the
        constant term (24) and add to give us the coefficient of the middle
        term (−11).
      </>
    ),
  },
  {
    title: "Find factor pairs",
    body: (
      <>
        We need two numbers that multiply to 24 and add to −11. Let&rsquo;s
        list the factor pairs of 24:
        <ul className="mt-2 space-y-1 pl-4">
          <li>
            <M>1 × 24 = 24</M>, and <M>1 + 24 = 25</M> (too big)
          </li>
          <li>
            <M>2 × 12 = 24</M>, and <M>2 + 12 = 14</M> (still too big)
          </li>
          <li>
            <M>3 × 8 = 24</M>, and <M>3 + 8 = 11</M> (close, but we need −11)
          </li>
        </ul>
        <p className="mt-2">
          Since we need the sum to be −11, we need both factors to be
          negative:{" "}
          <M>(−3) × (−8) = 24</M> and <M>(−3) + (−8) = −11 ✓</M>. Perfect.
        </p>
      </>
    ),
  },
  {
    title: "Write factored form",
    body: (
      <>
        Now we can write the quadratic as a product of two binomials. Since
        we found that −3 and −8 are our factors, we can write:
        <p className="mt-2 text-center">
          <M>
            x<sup>2</sup> − 11x + 24 = (x − 3)(x − 8) = 0
          </M>
        </p>
        <p className="mt-2">
          Verify by expanding:{" "}
          <M>
            (x − 3)(x − 8) = x<sup>2</sup> − 8x − 3x + 24 = x<sup>2</sup> −
            11x + 24 ✓
          </M>
        </p>
      </>
    ),
  },
  {
    title: "Apply zero product property",
    body: (
      <>
        When we have <M>(x − 3)(x − 8) = 0</M>, we use the{" "}
        <C>zero product property</C>: if the product of two factors equals
        zero, then at least one of the factors must equal zero. This gives
        us two separate equations:
        <ul className="mt-2 space-y-1 pl-4">
          <li>
            <M>x − 3 = 0</M>, which means <M>x = 3</M>
          </li>
          <li>
            <M>x − 8 = 0</M>, which means <M>x = 8</M>
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "Verify solutions",
    body: (
      <>
        Let&rsquo;s check both solutions in the original equation{" "}
        <M>
          x<sup>2</sup> − 11x + 24 = 0
        </M>
        .
        <p className="mt-2">
          For <M>x = 3</M>:{" "}
          <M>
            3<sup>2</sup> − 11(3) + 24 = 9 − 33 + 24 = 0 ✓
          </M>
        </p>
        <p className="mt-1">
          For <M>x = 8</M>:{" "}
          <M>
            8<sup>2</sup> − 11(8) + 24 = 64 − 88 + 24 = 0 ✓
          </M>
        </p>
        <p className="mt-2 font-medium text-[color:var(--color-text)]">
          Both solutions work.
        </p>
      </>
    ),
  },
];

const STEP_DWELL_MS = 3600;
const SOLVED_DWELL_MS = 2800;
const RESET_DELAY_MS = 500;
const FIRST_STEP_DELAY_MS = 600;

export function HeroStepsAnimation() {
  const [phase, setPhase] = useState<"solving" | "solved">("solving");
  const [currentStep, setCurrentStep] = useState(0);

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
          await wait(STEP_DWELL_MS);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalSteps = steps.length;
  const displayedStepIndex =
    phase === "solved" ? totalSteps - 1 : currentStep;
  const progressPct =
    phase === "solved"
      ? 100
      : ((displayedStepIndex + 1) / totalSteps) * 100;

  return (
    <div className="relative">
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
            {PROBLEM_TEXT}
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
              <>
                {/* Completed steps (collapsed rows) */}
                {steps.slice(0, currentStep).map((step, i) => (
                  <motion.div
                    key={`completed-${i}`}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
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
                  </motion.div>
                ))}

                {/* Current expanded step */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`current-${currentStep}`}
                    layout
                    initial={{ opacity: 0, y: 14, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    transition={{
                      duration: 0.45,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="rounded-xl border border-[color:var(--color-primary)]/30 bg-[color:var(--color-primary-bg)]/50 p-4"
                  >
                    <div className="flex items-start gap-3">
                      <StepBadge index={currentStep + 1} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[color:var(--color-primary)]">
                          Step {currentStep + 1}
                          <span className="mx-1.5 text-[color:var(--color-text-muted)]">
                            —
                          </span>
                          <span className="text-[color:var(--color-text)]">
                            {steps[currentStep].title}
                          </span>
                        </p>
                        <div className="mt-2 text-[13px] leading-relaxed text-[color:var(--color-text-secondary)]">
                          {steps[currentStep].body}
                        </div>
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
                  </motion.div>
                </AnimatePresence>
              </>
            ) : (
              /* Solved screen */
              <motion.div
                key="solved"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-xl border border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/5 p-6 text-center"
              >
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--color-success)]/15">
                  <svg
                    className="h-6 w-6 text-[color:var(--color-success)]"
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
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-text-muted)]">
                  Answer
                </p>
                <p className="mt-1 font-serif text-xl italic text-[color:var(--color-text)]">
                  x = 3 or x = 8
                </p>
                <p className="mt-3 text-sm font-bold text-[color:var(--color-text)]">
                  Problem Solved
                </p>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Floating pill */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className="absolute -bottom-4 -right-2 hidden rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] px-4 py-2 shadow-lg md:block"
      >
        <p className="text-[11px] font-semibold text-[color:var(--color-text)]">
          Real output. Real walkthrough.
        </p>
      </motion.div>
    </div>
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
