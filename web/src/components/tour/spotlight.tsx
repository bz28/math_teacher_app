"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { TourDefinition, TourPlacement } from "./types";

// Deep-green scrim per the Field Guide spec (#0E5238 @ ~86%).
const SCRIM = "rgba(14, 82, 56, 0.86)";
// Faint film grain layered over the scrim.
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";

const CARD_W = 340;
const GAP = 18; // distance between target edge and card
const MARGIN = 16; // min viewport margin

type Rect = { top: number; left: number; width: number; height: number };
type Side = "top" | "bottom" | "left" | "right" | "center";

/**
 * Locate the active step's target in the viewport. Retries for ~1.3s so
 * a target that mounts after a tab switch is still caught, then tracks
 * it through resize/scroll/layout shifts. Returns null when the control
 * genuinely isn't on screen (the card then centers, no cut-out).
 */
function useTargetRect(
  getTarget: (id: string) => HTMLElement | null,
  targetId: string,
  stepIndex: number,
  reduce: boolean | null,
): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let tries = 0;
    let scrolled = false;
    let ro: ResizeObserver | null = null;
    let cleanupMove: (() => void) | null = null;

    const sync = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    const find = () => {
      if (cancelled) return;
      const el = getTarget(targetId);
      if (el && el.getBoundingClientRect().width > 0) {
        if (!scrolled) {
          scrolled = true;
          el.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: reduce ? "auto" : "smooth",
          });
        }
        sync(el);
        ro = new ResizeObserver(() => sync(el));
        ro.observe(el);
        const onMove = () => sync(el);
        window.addEventListener("resize", onMove);
        window.addEventListener("scroll", onMove, true);
        cleanupMove = () => {
          window.removeEventListener("resize", onMove);
          window.removeEventListener("scroll", onMove, true);
        };
        return;
      }
      setRect(null);
      if (tries++ < 45) raf = requestAnimationFrame(find);
    };

    find();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      cleanupMove?.();
    };
  }, [getTarget, targetId, stepIndex, reduce]);

  return rect;
}

/** Choose a side that fits without covering the target, honouring the
 *  step's preference first. Falls back to a clamped bottom placement. */
function placeCard(
  rect: Rect,
  cardH: number,
  preferred: TourPlacement,
): { top: number; left: number; side: Side } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const clampX = (x: number) => Math.max(MARGIN, Math.min(x, vw - CARD_W - MARGIN));
  const clampY = (y: number) => Math.max(MARGIN, Math.min(y, vh - cardH - MARGIN));

  const order: Side[] = ["bottom", "top", "right", "left"];
  if (preferred !== "auto") {
    order.splice(order.indexOf(preferred), 1);
    order.unshift(preferred);
  }

  for (const side of order) {
    if (side === "bottom" && rect.top + rect.height + GAP + cardH <= vh - MARGIN) {
      return { top: rect.top + rect.height + GAP, left: clampX(cx - CARD_W / 2), side };
    }
    if (side === "top" && rect.top - GAP - cardH >= MARGIN) {
      return { top: rect.top - GAP - cardH, left: clampX(cx - CARD_W / 2), side };
    }
    if (side === "right" && rect.left + rect.width + GAP + CARD_W <= vw - MARGIN) {
      return { top: clampY(cy - cardH / 2), left: rect.left + rect.width + GAP, side };
    }
    if (side === "left" && rect.left - GAP - CARD_W >= MARGIN) {
      return { top: clampY(cy - cardH / 2), left: rect.left - GAP - CARD_W, side };
    }
  }
  return { top: clampY(rect.top + rect.height + GAP), left: clampX(cx - CARD_W / 2), side: "bottom" };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

interface SpotlightProps {
  definition: TourDefinition;
  stepIndex: number;
  getTarget: (id: string) => HTMLElement | null;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * Steps 1..N — a deep-green scrim with a feathered cut-out around the
 * target, a primary-ringed target, and an auto-positioned caption card
 * joined by a hairline leader line. Keyboard: ←/→ navigate, Esc skips.
 */
export function Spotlight({
  definition,
  stepIndex,
  getTarget,
  onNext,
  onBack,
  onSkip,
}: SpotlightProps) {
  const reduce = useReducedMotion();
  const step = definition.steps[stepIndex];
  const total = definition.steps.length;
  const isLast = stepIndex === total - 1;

  const rect = useTargetRect(getTarget, step.target, stepIndex, reduce);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [cardH, setCardH] = useState(190);

  // Measure the card so placement and the leader line account for its
  // real height.
  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [stepIndex, rect]);

  // Move keyboard focus to the card's primary action on each step.
  useEffect(() => {
    requestAnimationFrame(() => nextRef.current?.focus());
  }, [stepIndex]);

  // Keyboard navigation.
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onSkip();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onBack();
      }
    },
    [onNext, onBack, onSkip],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  // Focus trap inside the card.
  const onCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !cardRef.current) return;
    const f = cardRef.current.querySelectorAll<HTMLElement>("button");
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const hole = rect
    ? { top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }
    : null;

  const place =
    rect && hole
      ? placeCard(hole, cardH, step.placement ?? "auto")
      : {
          top: Math.max(MARGIN, window.innerHeight / 2 - cardH / 2),
          left: Math.max(MARGIN, window.innerWidth / 2 - CARD_W / 2),
          side: "center" as Side,
        };

  const spring = reduce
    ? { duration: 0.2 }
    : { type: "spring" as const, stiffness: 280, damping: 30, mass: 0.7 };

  return (
    <div className="pointer-events-none fixed inset-0 z-[45]">
      {/* Interaction blocker — sits below real modals (z-50) so a live
          handoff dialog stays usable, but blocks stray app clicks. */}
      <div className="pointer-events-auto absolute inset-0" aria-hidden onClick={(e) => e.preventDefault()} />

      {/* Scrim with a feathered cut-out via a large blurred box-shadow.
          No target → full scrim (no hole). */}
      {hole ? (
        <motion.div
          className="absolute rounded-[12px]"
          initial={false}
          animate={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
          transition={spring}
          style={{ boxShadow: `0 0 46px 9999px ${SCRIM}` }}
        />
      ) : (
        <div className="absolute inset-0" style={{ backgroundColor: SCRIM }} />
      )}

      {/* Grain film over the scrim. */}
      <div
        className="absolute inset-0 opacity-[0.06] mix-blend-overlay"
        style={{ backgroundImage: GRAIN, backgroundSize: "140px 140px" }}
        aria-hidden
      />

      {/* Target ring + soft cream glow. */}
      {hole && (
        <motion.div
          className="absolute rounded-[12px]"
          initial={false}
          animate={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
          transition={spring}
          style={{
            boxShadow:
              "0 0 0 1px var(--color-primary), 0 0 0 4px rgba(14,82,56,0.25), 0 0 26px 6px rgba(252,250,244,0.42)",
          }}
          aria-hidden
        />
      )}

      {/* Hairline leader line + dot from card to target. */}
      {hole && place.side !== "center" && (
        <Leader hole={hole} card={{ ...place, width: CARD_W, height: cardH }} />
      )}

      {/* Live region for screen readers. */}
      <p className="sr-only" aria-live="polite">
        {`Step ${stepIndex + 1} of ${total}: ${step.title}`}
      </p>

      {/* Caption card. */}
      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Tour step ${stepIndex + 1} of ${total}`}
        onKeyDown={onCardKeyDown}
        className="pointer-events-auto absolute z-[2] rounded-[--radius-lg] border border-border bg-[color:var(--color-card)] p-5 shadow-lg"
        style={{ width: CARD_W }}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, top: place.top, left: place.left }}
        transition={reduce ? { duration: 0.18 } : { ...spring, opacity: { duration: 0.2 } }}
        key={stepIndex}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] font-semibold tracking-[0.14em] text-[color:var(--color-primary)]">
            {pad2(stepIndex + 1)} / {pad2(total)}
          </span>
          <button
            type="button"
            onClick={onSkip}
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Skip tour
          </button>
        </div>

        {step.eyebrow && (
          <p className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            {step.eyebrow}
          </p>
        )}
        <h2 className="mt-1 font-serif text-[1.5rem] leading-[1.12] tracking-[-0.01em] text-text-primary">
          {step.title}
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">{step.body}</p>

        {/* Tick progress rule. */}
        <div className="mt-4 flex items-center gap-1.5" aria-hidden>
          {definition.steps.map((_, i) => (
            <span
              key={i}
              className={`h-px flex-1 rounded-full transition-colors ${
                i <= stepIndex ? "bg-[color:var(--color-primary)]" : "bg-border"
              }`}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-[--radius-sm] px-2 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Back
          </button>
          <button
            ref={nextRef}
            type="button"
            onClick={onNext}
            className="rounded-[--radius-pill] bg-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {isLast ? "Finish" : "Next"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/** A 1px hairline from the card's facing edge to the target, ending in
 *  a small filled dot at the target. */
function Leader({
  hole,
  card,
}: {
  hole: Rect;
  card: { top: number; left: number; side: Side; width: number; height: number };
}) {
  const tCx = hole.left + hole.width / 2;
  const tCy = hole.top + hole.height / 2;
  let from = { x: 0, y: 0 };
  let to = { x: tCx, y: tCy };
  switch (card.side) {
    case "bottom":
      from = { x: card.left + card.width / 2, y: card.top };
      to = { x: tCx, y: hole.top + hole.height };
      break;
    case "top":
      from = { x: card.left + card.width / 2, y: card.top + card.height };
      to = { x: tCx, y: hole.top };
      break;
    case "right":
      from = { x: card.left, y: card.top + card.height / 2 };
      to = { x: hole.left + hole.width, y: tCy };
      break;
    case "left":
      from = { x: card.left + card.width, y: card.top + card.height / 2 };
      to = { x: hole.left, y: tCy };
      break;
  }
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="rgba(252,250,244,0.55)"
        strokeWidth={1}
      />
      <circle cx={to.x} cy={to.y} r={2.5} fill="rgba(252,250,244,0.9)" />
    </svg>
  );
}
