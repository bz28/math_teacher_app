"use client";

import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTour } from "./tour-provider";
import { WelcomeCover } from "./welcome-cover";
import { Spotlight } from "./spotlight";

/**
 * Renders the active tour into a body portal: the welcome cover (step
 * 0), the spotlight coachmarks (steps 1..N), or — while a step has
 * handed off to a real surface — a slim resume bar that yields the
 * screen to that surface.
 */
export function TourOverlay() {
  const { phase, definition, stepIndex, handoffActive, next, back, end, getTarget } = useTour();

  // The overlay only mounts once a tour is active (user/effect-driven,
  // never during hydration), so guarding on `document` is enough — no
  // mounted-flag effect needed.
  if (typeof document === "undefined" || phase === "idle" || !definition) return null;

  const step = definition.steps[stepIndex];

  const body = (
    <AnimatePresence>
      {phase === "welcome" && definition.cover && (
        <WelcomeCover key="cover" cover={definition.cover} onTakeTour={next} onSkip={end} />
      )}

      {phase === "steps" && (
        <Spotlight
          key="spotlight"
          definition={definition}
          stepIndex={stepIndex}
          handoffActive={handoffActive}
          getTarget={getTarget}
          onNext={next}
          onBack={back}
          onSkip={end}
        />
      )}

      {phase === "steps" && handoffActive && step.handoff && (
        <motion.div
          key="handoff"
          className="fixed inset-x-0 bottom-6 z-[55] flex justify-center px-4"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.22 }}
        >
          <div
            role="dialog"
            aria-label="Tour handoff"
            className="pointer-events-auto flex items-center gap-4 rounded-[--radius-pill] border border-border bg-[color:var(--color-card)] py-2.5 pl-5 pr-2.5 shadow-lg"
          >
            <p className="text-[13px] text-text-secondary">{step.handoff.hint}</p>
            {step.handoff.gate ? (
              // Create-or-skip gate (step one): no "Continue" — advancing
              // here would play later steps on the courses list, where
              // their targets don't exist. The only way forward is
              // creating a course (the host page advances on success);
              // cancelling the dialog returns to the spotlight. The lone
              // resume-bar control is the escape hatch out of the tour.
              <button
                type="button"
                onClick={end}
                className="rounded-[--radius-pill] px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
              >
                Skip tour
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={back}
                  className="rounded-[--radius-pill] px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="rounded-[--radius-pill] bg-primary px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
                >
                  Continue
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(body, document.body);
}
