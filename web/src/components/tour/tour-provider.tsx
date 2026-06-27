"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getTour } from "./tours";
import { TourOverlay } from "./tour-overlay";
import type { TourDefinition, TourPersona } from "./types";

/** "idle" = no tour; "welcome" = cover (spec step 0); "steps" = a
 *  spotlight coachmark is active. */
type TourPhase = "idle" | "welcome" | "steps";

interface TourContextValue {
  // ── controller ──
  phase: TourPhase;
  definition: TourDefinition | null;
  stepIndex: number;
  /** When true the overlay yields to a real surface the step opened
   *  (e.g. the New section dialog) and shows a slim resume bar. */
  handoffActive: boolean;
  isActive: boolean;
  start: (persona: TourPersona) => void;
  next: () => void;
  back: () => void;
  /** Dismiss the tour (skip or finish). Both mark the persona seen. */
  end: () => void;

  // ── action registry (host pages register imperative handoffs) ──
  registerAction: (name: string, fn: () => void) => () => void;
  runAction: (name: string) => void;

  // ── target registry (the DOM is the registry, via data-tour-id) ──
  getTarget: (id: string) => HTMLElement | null;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within <TourProvider>");
  return ctx;
}

/**
 * Sugar for a control that wants to be a tour target. Spread onto the
 * element: `<button {...useTourTarget(TOUR_IDS.teacherNewSection)}>`.
 * Stamps a `data-tour-id`, which the engine resolves via querySelector.
 */
export function useTourTarget(id: string): { "data-tour-id": string } {
  return { "data-tour-id": id };
}

/**
 * Register a named imperative handoff for the active tour (e.g. switch
 * tabs, open a modal). The latest closure is always used, so callers
 * can pass inline functions without memoizing.
 */
export function useTourAction(name: string, fn: () => void): void {
  const { registerAction } = useTour();
  const fnRef = useRef(fn);
  // Keep the ref pointing at the latest closure without touching it
  // during render (refs are not render-time values).
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    return registerAction(name, () => fnRef.current());
  }, [name, registerAction]);
}

export function TourProvider({
  children,
  onComplete,
}: {
  children: React.ReactNode;
  /** Called with the persona when a tour is dismissed (skip or finish)
   *  — wire to persistence so it won't auto-mount again. */
  onComplete?: (persona: TourPersona) => void;
}) {
  const [phase, setPhase] = useState<TourPhase>("idle");
  const [definition, setDefinition] = useState<TourDefinition | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [handoffActive, setHandoffActive] = useState(false);

  const actionsRef = useRef(new Map<string, () => void>());

  const registerAction = useCallback((name: string, fn: () => void) => {
    actionsRef.current.set(name, fn);
    return () => {
      // Only delete if still pointing at this registration.
      if (actionsRef.current.get(name) === fn) actionsRef.current.delete(name);
    };
  }, []);

  const runAction = useCallback((name: string) => {
    actionsRef.current.get(name)?.();
  }, []);

  const getTarget = useCallback((id: string): HTMLElement | null => {
    if (typeof document === "undefined") return null;
    return document.querySelector<HTMLElement>(`[data-tour-id="${id}"]`);
  }, []);

  const start = useCallback((persona: TourPersona) => {
    const def = getTour(persona);
    if (!def) return;
    setDefinition(def);
    setStepIndex(0);
    setHandoffActive(false);
    setPhase("welcome");
  }, []);

  const end = useCallback(() => {
    setPhase("idle");
    setHandoffActive(false);
    if (definition) onComplete?.(definition.persona);
    setDefinition(null);
  }, [definition, onComplete]);

  const next = useCallback(() => {
    if (phase === "welcome") {
      setPhase("steps");
      setStepIndex(0);
      return;
    }
    if (phase !== "steps" || !definition) return;
    const step = definition.steps[stepIndex];
    // Live handoff: first Next opens the real surface and pauses;
    // second Next (Continue) closes it and advances.
    if (step?.handoff && !handoffActive) {
      runAction(step.handoff.open);
      setHandoffActive(true);
      return;
    }
    if (step?.handoff && handoffActive) runAction(step.handoff.close);
    setHandoffActive(false);
    if (stepIndex >= definition.steps.length - 1) {
      end();
    } else {
      // Pre-warm the next step's target before it opens (forward only).
      if (step?.onLeave) runAction(step.onLeave);
      setStepIndex((i) => i + 1);
    }
  }, [phase, definition, stepIndex, handoffActive, runAction, end]);

  const back = useCallback(() => {
    if (phase !== "steps" || !definition) return;
    if (handoffActive) {
      const step = definition.steps[stepIndex];
      if (step?.handoff) runAction(step.handoff.close);
      setHandoffActive(false);
      return;
    }
    if (stepIndex <= 0) {
      setPhase("welcome");
    } else {
      setStepIndex((i) => i - 1);
    }
  }, [phase, definition, stepIndex, handoffActive, runAction]);

  // Run each step's onEnter handoff (tab switch, etc.) as it becomes
  // active. Excluded from handoffActive so opening a modal doesn't
  // re-fire onEnter.
  useEffect(() => {
    if (phase !== "steps" || !definition) return;
    const step = definition.steps[stepIndex];
    if (step?.onEnter) runAction(step.onEnter);
  }, [phase, stepIndex, definition, runAction]);

  const value = useMemo<TourContextValue>(
    () => ({
      phase,
      definition,
      stepIndex,
      handoffActive,
      isActive: phase !== "idle",
      start,
      next,
      back,
      end,
      registerAction,
      runAction,
      getTarget,
    }),
    [
      phase,
      definition,
      stepIndex,
      handoffActive,
      start,
      next,
      back,
      end,
      registerAction,
      runAction,
      getTarget,
    ],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      <TourOverlay />
    </TourContext.Provider>
  );
}
