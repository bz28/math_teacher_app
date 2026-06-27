"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * "How this is measured" — a quiet, opt-in key that names what the
 * practice-signal words mean in plain English. Default collapsed so the
 * teacher surfaces stay calm; expanding is a deliberate choice.
 *
 * Shared by the per-student engagement readout (where it explains the
 * outcome bar's First-try / Retried / Revealed segments) and the class
 * struggle panel (where it pins down what "struggled" counts as), so the
 * definitions stay identical wherever these words appear. It reinforces
 * the "insight, not a score" framing — a nudge on what to revisit, never
 * a grade.
 */

const ENTRIES: { term: string; def: string }[] = [
  { term: "First try", def: "Got it right on the first attempt." },
  { term: "Retried", def: "Missed once, then got it right on a second try." },
  { term: "Revealed", def: "Missed twice, so the answer was shown." },
  { term: "Walkthrough", def: "Finished a step-by-step Learn." },
  {
    term: "“Struggled”",
    def: "A retry or a reveal — not a wrong-on-a-test. A nudge on what to revisit, not a grade.",
  },
];

export function MeasuredKey({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-1.5 rounded-[--radius-sm] text-[11px] text-text-muted transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <svg
          aria-hidden
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        >
          <circle cx="6" cy="6" r="5" />
          <line x1="6" y1="5.4" x2="6" y2="8.6" strokeLinecap="round" />
          <circle cx="6" cy="3.5" r="0.5" fill="currentColor" stroke="none" />
        </svg>
        How this is measured
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <dl className="mt-3 max-w-xl space-y-2 rounded-[--radius-md] border border-border-light bg-bg-subtle px-4 py-3.5">
              {ENTRIES.map((e) => (
                <div key={e.term} className="text-[12px] leading-snug">
                  <dt className="inline font-semibold text-text-secondary">
                    {e.term}
                  </dt>
                  <dd className="inline text-text-muted"> — {e.def}</dd>
                </div>
              ))}
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
