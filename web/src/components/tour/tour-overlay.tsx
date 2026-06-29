"use client";

import { useEffect, useRef } from "react";
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

  // The portal's single host node, a direct child of document.body. We
  // mark every OTHER body child inert + aria-hidden while the tour is up
  // so the modal semantics are real: the pointer blocker stops mouse
  // clicks, and inert stops keyboard/AT traversal into the page behind
  // the scrim. The host (cover, spotlight, live region) stays reachable.
  const hostRef = useRef<HTMLDivElement>(null);

  const active = typeof document !== "undefined" && phase !== "idle" && !!definition;
  // Lift inert during a handoff: a live handoff opens a REAL app surface
  // (the New course / New section dialog) that renders inline in the app
  // tree — inerting that tree would make the dialog unreachable, breaking
  // the handoff. The handoff is the one moment the page behind is meant
  // to be used; the spotlight yields (pointer-events none) then too.
  const inertActive = active && !handoffActive;

  useEffect(() => {
    if (!inertActive) return;
    const host = hostRef.current;
    if (!host) return;
    const changed: { el: HTMLElement; prevAria: string | null; prevInert: boolean }[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === host || !(child instanceof HTMLElement)) continue;
      changed.push({ el: child, prevAria: child.getAttribute("aria-hidden"), prevInert: child.inert });
      child.setAttribute("aria-hidden", "true");
      child.inert = true;
    }
    return () => {
      for (const c of changed) {
        if (c.prevAria === null) c.el.removeAttribute("aria-hidden");
        else c.el.setAttribute("aria-hidden", c.prevAria);
        c.el.inert = c.prevInert;
      }
    };
  }, [inertActive]);

  // The overlay only mounts once a tour is active (user/effect-driven,
  // never during hydration), so guarding on `document` is enough — no
  // mounted-flag effect needed.
  if (!active || !definition) return null;

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

  // A plain wrapper (no layout/transform) so its fixed children still
  // position against the viewport; it just gives us one identifiable
  // host node to exclude from the inert sweep above.
  return createPortal(<div ref={hostRef}>{body}</div>, document.body);
}
