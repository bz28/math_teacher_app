"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Step = {
  label: string;
  hint: string;
};

const PROBLEM_TEX = "2x + 5 = 17";
const PROBLEM_WORDS = "Solve for x.";

const steps: Step[] = [
  {
    label: "Start with what you know",
    hint: "You have an equation with one variable. What's the goal? Get x by itself on one side.",
  },
  {
    label: "Subtract 5 from both sides",
    hint: "To isolate the 2x term, undo the +5 on the left. Whatever you do to one side, you do to the other.",
  },
  {
    label: "Divide both sides by 2",
    hint: "Now you have 2x = 12. Divide both sides by 2 to get x alone.",
  },
  {
    label: "Check your answer",
    hint: "You should get x = 6. Plug it back into the original equation and make sure it works.",
  },
];

const STEP_INTERVAL_MS = 1600;
const HOLD_AFTER_LAST_MS = 2200;
const FIRST_STEP_DELAY_MS = 700;

export function HeroStepsAnimation() {
  // visibleCount ranges 0..steps.length. Increments on a timer, resets after a hold.
  const [visibleCount, setVisibleCount] = useState(0);
  const [cycleKey, setCycleKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      while (!cancelled) {
        // Reset
        setVisibleCount(0);
        await wait(FIRST_STEP_DELAY_MS);
        if (cancelled) return;

        // Reveal each step
        for (let i = 1; i <= steps.length; i++) {
          setVisibleCount(i);
          await wait(STEP_INTERVAL_MS);
          if (cancelled) return;
        }

        // Hold
        await wait(HOLD_AFTER_LAST_MS);
        if (cancelled) return;

        // Bump cycle so AnimatePresence can exit cleanly
        setCycleKey((k) => k + 1);
        await wait(400);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        <div className="p-6 md:p-7">
          {/* Problem card */}
          <div className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-text-muted)]">
              Problem
            </p>
            <p className="mt-2 font-mono text-xl font-bold text-[color:var(--color-text)] md:text-2xl">
              {PROBLEM_TEX}
            </p>
            <p className="mt-1 text-sm text-[color:var(--color-text-secondary)]">
              {PROBLEM_WORDS}
            </p>
          </div>

          {/* Steps */}
          <div className="mt-5 space-y-3">
            <AnimatePresence mode="popLayout">
              {steps.slice(0, visibleCount).map((step, i) => (
                <motion.div
                  key={`${cycleKey}-${i}`}
                  layout
                  initial={{ opacity: 0, y: 14, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.98 }}
                  transition={{
                    duration: 0.45,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="flex items-start gap-3 rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-4"
                >
                  <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary-bg)] text-xs font-bold text-[color:var(--color-primary)]">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[color:var(--color-text)]">
                      {step.label}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-[color:var(--color-text-secondary)]">
                      {step.hint}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Typing indicator between steps */}
            <AnimatePresence>
              {visibleCount < steps.length && (
                <motion.div
                  key={`typing-${cycleKey}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="flex items-center gap-3 pl-1"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--color-primary-bg)]">
                    <span className="flex gap-1">
                      <Dot delay={0} />
                      <Dot delay={150} />
                      <Dot delay={300} />
                    </span>
                  </span>
                  <span className="text-xs font-medium text-[color:var(--color-text-muted)]">
                    Veradic is thinking…
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Tiny floating chat bubble badge */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className="absolute -bottom-4 -right-2 hidden rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] px-4 py-2 shadow-lg md:block"
      >
        <p className="text-[11px] font-semibold text-[color:var(--color-text)]">
          No answers. Just guidance.
        </p>
      </motion.div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <motion.span
      className="h-1 w-1 rounded-full bg-[color:var(--color-primary)]"
      animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
      transition={{
        duration: 0.9,
        repeat: Infinity,
        ease: "easeInOut",
        delay: delay / 1000,
      }}
    />
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
