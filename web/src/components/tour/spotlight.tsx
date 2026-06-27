"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "framer-motion";
import type { TourDefinition, TourPlacement } from "./types";

// Deep-green scrim per the Field Guide spec (#0E5238 @ ~86%).
const SCRIM = "rgba(14, 82, 56, 0.86)";
// Faint film grain layered over the scrim.
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";

const CARD_W = 340;
const GAP = 18; // distance between target edge and card
const MARGIN = 16; // min viewport margin
const HOLE_PAD = 6; // padding between target and cut-out edge

// How long to keep looking for a step's target before giving up and
// centering the card. Generous enough to cover a cross-page handoff —
// e.g. creating the first course navigates into its workspace, which
// must fetch the course before the "New section" target mounts — not
// just an in-page tab switch.
const TARGET_RETRY_MS = 4000;
// After a target first resolves, keep re-measuring for a short window so
// an ancestor that expands WITHOUT a scroll (e.g. the roster opening and
// pushing the invite textarea down) — which a node-scoped ResizeObserver
// never sees — is still tracked instead of leaving the hole behind.
const RESYNC_MS = 600;

type Rect = { top: number; left: number; width: number; height: number };
type Side = "top" | "bottom" | "left" | "right" | "center";
type RectStatus = "searching" | "resolved" | "missing";

/**
 * Locate the active step's target in the viewport. Retries for a few
 * seconds so a target that mounts after a tab switch — or a full
 * cross-page navigation + data fetch — is still caught, then tracks it
 * through resize/scroll/layout shifts.
 *
 * Crucially it RETAINS the last-known rect on a transient miss (it never
 * nulls mid-search), so the cut-out holds steady and then GLIDES to the
 * new target once measured, instead of blinking to a full scrim and
 * popping in at the destination. The rect is only cleared once the retry
 * genuinely fails (status → "missing"), at which point the card centers.
 */
function useTargetRect(
  getTarget: (id: string) => HTMLElement | null,
  targetId: string,
  stepIndex: number,
  reduce: boolean | null,
): { rect: Rect | null; status: RectStatus } {
  const [rect, setRect] = useState<Rect | null>(null);
  const [status, setStatus] = useState<RectStatus>("searching");

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let resyncRaf = 0;
    const deadline = Date.now() + TARGET_RETRY_MS;
    let scrolled = false;
    let ro: ResizeObserver | null = null;
    let cleanupMove: (() => void) | null = null;

    const sync = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    const find = () => {
      if (cancelled) return;
      // New step: resume searching but KEEP the prior rect so the cut-out
      // holds its last position and glides to the new one once found.
      // (React no-ops when the status is already "searching".)
      setStatus((s) => (s === "resolved" || s === "missing" ? "searching" : s));
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
        setStatus("resolved");
        // Track explicit layout shifts...
        ro = new ResizeObserver(() => sync(el));
        ro.observe(el);
        // ...and the document body, so an ancestor growing taller (no
        // scroll, no node resize) still re-measures the target.
        if (document.body) ro.observe(document.body);
        const onMove = () => sync(el);
        window.addEventListener("resize", onMove);
        window.addEventListener("scroll", onMove, true);
        cleanupMove = () => {
          window.removeEventListener("resize", onMove);
          window.removeEventListener("scroll", onMove, true);
        };
        // Short rAF re-sync loop to catch silent ancestor expansion that
        // fires no observer (the roster-expand case).
        const resyncDeadline = Date.now() + RESYNC_MS;
        const resync = () => {
          if (cancelled) return;
          const live = getTarget(targetId);
          if (live) sync(live);
          if (Date.now() < resyncDeadline) resyncRaf = requestAnimationFrame(resync);
        };
        resyncRaf = requestAnimationFrame(resync);
        return;
      }
      // Transient miss: do NOT null the rect — hold the last-known
      // position so the hole glides rather than blinks.
      if (Date.now() < deadline) {
        raf = requestAnimationFrame(find);
      } else {
        // Genuine failure after the full retry window — only now fall
        // back to a full scrim + centered card.
        setRect(null);
        setStatus("missing");
      }
    };

    find();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(resyncRaf);
      ro?.disconnect();
      cleanupMove?.();
    };
  }, [getTarget, targetId, stepIndex, reduce]);

  return { rect, status };
}

/** Choose a side that fits without covering the target, honouring the
 *  step's preference first. The `bottom-start` / `bottom-end` variants
 *  pin the card's left / right edge to the target instead of centering
 *  it. Falls back to a clamped bottom placement. */
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
  const fitsBelow = rect.top + rect.height + GAP + cardH <= vh - MARGIN;

  // Edge-pinned bottom variants — used when the target hugs an edge and
  // a centered card would overhang.
  if ((preferred === "bottom-start" || preferred === "bottom-end") && fitsBelow) {
    const left = preferred === "bottom-start" ? rect.left : rect.left + rect.width - CARD_W;
    return { top: rect.top + rect.height + GAP, left: clampX(left), side: "bottom" };
  }

  // Normalise the aligned variants to their base direction for the
  // generic fit search below.
  const base: Side =
    preferred === "bottom-start" || preferred === "bottom-end"
      ? "bottom"
      : preferred === "auto"
        ? "bottom"
        : (preferred as Side);

  const order: Side[] = ["bottom", "top", "right", "left"];
  if (preferred !== "auto") {
    order.splice(order.indexOf(base), 1);
    order.unshift(base);
  }

  for (const side of order) {
    if (side === "bottom" && fitsBelow) {
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
  /** True while the step has handed off to a real surface (a dialog).
   *  The scrim + cut-out stay mounted and held steady; only the caption
   *  card fades out and yields pointer events to the live dialog. */
  handoffActive: boolean;
  getTarget: (id: string) => HTMLElement | null;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * Steps 1..N — a deep-green scrim with a feathered cut-out around the
 * target, a ringed target, and an auto-positioned caption card joined by
 * a hairline leader line. The cut-out and card are persisted across
 * steps and GLIDE to each new target on a shared layout spring (they
 * travel together); only the card's text crossfades. Keyboard: ←/→
 * navigate, Esc skips.
 */
export function Spotlight({
  definition,
  stepIndex,
  handoffActive,
  getTarget,
  onNext,
  onBack,
  onSkip,
}: SpotlightProps) {
  const reduce = useReducedMotion();
  const step = definition.steps[stepIndex];
  const total = definition.steps.length;
  const isLast = stepIndex === total - 1;
  const emphatic = !!step.handoff; // handoff steps invite a press; calm ring otherwise.

  const { rect, status } = useTargetRect(getTarget, step.target, stepIndex, reduce);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [cardH, setCardH] = useState(190);

  // Animated geometry shared by the scrim cut-out, the ring, the leader,
  // and the card — the single source of truth so everything glides in
  // lockstep instead of each element snapping independently.
  const holeTop = useMotionValue(0);
  const holeLeft = useMotionValue(0);
  const holeW = useMotionValue(0);
  const holeH = useMotionValue(0);
  const holeScale = useMotionValue(1);
  const holeOpacity = useMotionValue(0);
  const cardTop = useMotionValue(0);
  const cardLeft = useMotionValue(0);
  const leaderDraw = useMotionValue(0);
  const leaderOpacity = useMotionValue(0);

  const positioned = useRef(false);

  const hole = rect
    ? {
        top: rect.top - HOLE_PAD,
        left: rect.left - HOLE_PAD,
        width: rect.width + HOLE_PAD * 2,
        height: rect.height + HOLE_PAD * 2,
      }
    : null;

  const place = hole ? placeCard(hole, cardH, step.placement ?? "auto") : null;
  const side = place?.side ?? "center";

  // Measure the card so placement and the leader line account for its
  // real height.
  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [stepIndex, rect]);

  // Drive the shared geometry. First positioning sets values without a
  // spring (no glide-from-origin) and plays an entrance; every step after
  // springs hole + card from their held position to the new target.
  useLayoutEffect(() => {
    const layoutSpring = reduce
      ? { duration: 0.2 }
      : { type: "spring" as const, stiffness: 210, damping: 26, mass: 0.8 };

    // Card target position: glide to the placement, or center when there
    // is no resolved target.
    const cardTo = place
      ? { top: place.top, left: place.left }
      : {
          top: Math.max(MARGIN, window.innerHeight / 2 - cardH / 2),
          left: Math.max(MARGIN, window.innerWidth / 2 - CARD_W / 2),
        };

    if (!positioned.current) {
      // First appearance.
      cardTop.set(cardTo.top);
      cardLeft.set(cardTo.left);
      if (hole) {
        positioned.current = true;
        holeTop.set(hole.top);
        holeLeft.set(hole.left);
        holeW.set(hole.width);
        holeH.set(hole.height);
        if (reduce) {
          holeOpacity.set(1);
          holeScale.set(1);
        } else {
          // Green washes in (~350ms); the cut-out finishes settling
          // ~150ms after, so the hole reads as the green landing then the
          // target lighting up — not a single hard frame.
          animate(holeOpacity, 1, { duration: 0.35 });
          animate(holeScale, [1.06, 1], { duration: 0.35, delay: 0.15 });
        }
      }
      return;
    }

    // Subsequent steps: glide together on the shared spring.
    animate(cardTop, cardTo.top, layoutSpring);
    animate(cardLeft, cardTo.left, layoutSpring);
    if (hole) {
      holeOpacity.set(1);
      animate(holeTop, hole.top, layoutSpring);
      animate(holeLeft, hole.left, layoutSpring);
      animate(holeW, hole.width, layoutSpring);
      animate(holeH, hole.height, layoutSpring);
      if (!reduce) animate(holeScale, [1.04, 1], { duration: 0.2 });
    } else {
      // Lost the target after having one — hold the cut-out faded.
      animate(holeOpacity, 0, { duration: 0.2 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hole?.top, hole?.left, hole?.width, hole?.height, place?.top, place?.left, cardH, reduce]);

  // Leader line: fade out on a step change, then draw on once the box has
  // settled at the new target.
  useEffect(() => {
    if (!hole || side === "center") {
      animate(leaderOpacity, 0, { duration: 0.12 });
      return;
    }
    leaderDraw.set(0);
    animate(leaderOpacity, 0, { duration: 0.12 });
    const settle = reduce ? 0 : 420; // ~ spring travel time
    const t = window.setTimeout(() => {
      animate(leaderOpacity, 1, { duration: 0.12 });
      animate(leaderDraw, 1, { duration: reduce ? 0 : 0.25, ease: "easeOut" });
    }, settle);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, side, reduce]);

  // Move keyboard focus to the card's primary action on each step.
  useEffect(() => {
    if (handoffActive) return;
    requestAnimationFrame(() => nextRef.current?.focus());
  }, [stepIndex, handoffActive]);

  // Keyboard navigation — suspended during a handoff so the live dialog
  // owns the keyboard.
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (handoffActive) return;
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
    [onNext, onBack, onSkip, handoffActive],
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

  // Searching with no rect at all (the very first resolve, or a genuine
  // wait) — show an intentional "Finding…" state instead of a bare
  // centered card so the pause reads as deliberate.
  const finding = !hole && status === "searching";

  return (
    <div className="pointer-events-none fixed inset-0 z-[45]">
      {/* Interaction blocker — sits below real modals (z-50) so a live
          handoff dialog stays usable, but blocks stray app clicks. */}
      <div className="pointer-events-auto absolute inset-0" aria-hidden onClick={(e) => e.preventDefault()} />

      {/* Full scrim when there's no resolved target (no cut-out). */}
      {!hole && (
        <motion.div
          className="absolute inset-0"
          style={{ backgroundColor: SCRIM }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
        />
      )}

      {/* Scrim with a feathered cut-out via a large blurred box-shadow.
          Persisted + glided, never remounted between steps. */}
      {hole && (
        <motion.div
          className="absolute rounded-[12px]"
          style={{
            top: holeTop,
            left: holeLeft,
            width: holeW,
            height: holeH,
            scale: holeScale,
            opacity: holeOpacity,
            boxShadow: `0 0 46px 9999px ${SCRIM}`,
          }}
        />
      )}

      {/* Grain film over the scrim. */}
      <div
        className="absolute inset-0 opacity-[0.06] mix-blend-overlay"
        style={{ backgroundImage: GRAIN, backgroundSize: "140px 140px" }}
        aria-hidden
      />

      {/* Target ring. Emphatic glow on handoff steps (Next opens a real
          dialog — "press here"); a calm hairline otherwise ("look here",
          no glow pulse that begs a click the overlay would eat). */}
      {hole && (
        <motion.div
          className="absolute rounded-[12px]"
          style={{
            top: holeTop,
            left: holeLeft,
            width: holeW,
            height: holeH,
            scale: holeScale,
            opacity: holeOpacity,
            boxShadow: emphatic
              ? "0 0 0 1px var(--color-primary), 0 0 0 4px rgba(14,82,56,0.25), 0 0 26px 6px rgba(252,250,244,0.42)"
              : "0 0 0 1px rgba(252,250,244,0.55)",
          }}
          aria-hidden
        />
      )}

      {/* Hairline leader line + dot from card to target, tracking the
          animating box. Hidden during a handoff — the card it springs
          from is faded out, so a line from empty space would dangle. */}
      {hole && side !== "center" && !handoffActive && (
        <Leader
          holeTop={holeTop}
          holeLeft={holeLeft}
          holeW={holeW}
          holeH={holeH}
          cardTop={cardTop}
          cardLeft={cardLeft}
          cardH={cardH}
          side={side}
          draw={leaderDraw}
          opacity={leaderOpacity}
        />
      )}

      {/* Live region for screen readers. */}
      <p className="sr-only" aria-live="polite">
        {`Step ${stepIndex + 1} of ${total}: ${step.title}`}
      </p>

      {finding ? (
        <FindingCard cardTop={cardTop} cardLeft={cardLeft} onSkip={onSkip} reduce={reduce} />
      ) : (
        <motion.div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Tour step ${stepIndex + 1} of ${total}`}
          onKeyDown={onCardKeyDown}
          className="absolute z-[2] rounded-[--radius-lg] border border-border bg-[color:var(--color-card)] p-5 shadow-lg"
          style={{
            width: CARD_W,
            top: cardTop,
            left: cardLeft,
            pointerEvents: handoffActive ? "none" : "auto",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: handoffActive ? 0 : 1 }}
          transition={{ duration: handoffActive ? 0.18 : 0.25 }}
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

          {/* Crossfade only the text between steps — the card frame stays
              put and glides; the words swap. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={stepIndex}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: reduce ? 0.12 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              {step.eyebrow && (
                <p className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
                  {step.eyebrow}
                </p>
              )}
              <h2 className="mt-1 font-serif text-[1.5rem] leading-[1.12] tracking-[-0.01em] text-text-primary">
                {step.title}
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">{step.body}</p>
            </motion.div>
          </AnimatePresence>

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
      )}
    </div>
  );
}

/** Centered "looking for the target" state — a soft pulse so the wait
 *  reads as deliberate rather than a broken/empty spotlight. */
function FindingCard({
  cardTop,
  cardLeft,
  onSkip,
  reduce,
}: {
  cardTop: MotionValue<number>;
  cardLeft: MotionValue<number>;
  onSkip: () => void;
  reduce: boolean | null;
}) {
  return (
    <motion.div
      className="pointer-events-auto absolute z-[2] flex w-[300px] flex-col items-center gap-3 rounded-[--radius-lg] border border-border bg-[color:var(--color-card)] px-6 py-7 text-center shadow-lg"
      style={{ top: cardTop, left: cardLeft }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <motion.span
        className="h-2.5 w-2.5 rounded-full bg-[color:var(--color-primary)]"
        animate={reduce ? {} : { opacity: [0.35, 1, 0.35], scale: [0.9, 1.1, 0.9] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden
      />
      <p className="font-serif text-[15px] italic text-text-secondary">Finding your roster…</p>
      <button
        type="button"
        onClick={onSkip}
        className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        Skip tour
      </button>
    </motion.div>
  );
}

/** A 1px hairline from the card's facing edge to the target, ending in a
 *  small filled dot. Endpoints are derived from the LIVE animating
 *  geometry so the line tracks the box as it glides, then draws on once
 *  settled. */
function Leader({
  holeTop,
  holeLeft,
  holeW,
  holeH,
  cardTop,
  cardLeft,
  cardH,
  side,
  draw,
  opacity,
}: {
  holeTop: MotionValue<number>;
  holeLeft: MotionValue<number>;
  holeW: MotionValue<number>;
  holeH: MotionValue<number>;
  cardTop: MotionValue<number>;
  cardLeft: MotionValue<number>;
  cardH: number;
  side: Side;
  draw: MotionValue<number>;
  opacity: MotionValue<number>;
}) {
  // Card-side anchor.
  const x1 = useTransform(cardLeft, (cl) =>
    side === "left" ? cl + CARD_W : side === "right" ? cl : cl + CARD_W / 2,
  );
  const y1 = useTransform(cardTop, (ct) =>
    side === "top" ? ct + cardH : side === "bottom" ? ct : ct + cardH / 2,
  );
  // Target-side anchor.
  const x2 = useTransform([holeLeft, holeW], ([hl, hw]: number[]) =>
    side === "left" ? hl : side === "right" ? hl + hw : hl + hw / 2,
  );
  const y2 = useTransform([holeTop, holeH], ([ht, hh]: number[]) =>
    side === "top" ? ht : side === "bottom" ? ht + hh : ht + hh / 2,
  );

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <motion.line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="rgba(252,250,244,0.55)"
        strokeWidth={1}
        style={{ pathLength: draw, opacity }}
      />
      <motion.circle
        cx={x2}
        cy={y2}
        r={2.5}
        fill="rgba(252,250,244,0.9)"
        style={{ scale: draw, opacity, transformBox: "fill-box", transformOrigin: "center" }}
      />
    </svg>
  );
}
