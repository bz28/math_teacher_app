"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * The editorial celebration medallion — a warm cream disc inside a
 * deep-green ring, with a checkmark that draws itself in. The single
 * tasteful flourish of the payoff surfaces: a quiet seal of completion,
 * not a confetti burst. Respects reduced-motion (renders the finished
 * mark with no draw).
 */
export function CelebrationMedallion({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <div className={cn("relative mx-auto h-20 w-20", className)}>
      {/* Soft halo — a barely-there warmth behind the seal. */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full bg-primary/10 blur-md"
        initial={reduce ? { opacity: 0.6 } : { opacity: 0, scale: 0.6 }}
        animate={{ opacity: 0.6, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
      />
      <div className="relative flex h-full w-full items-center justify-center rounded-full border border-primary/25 bg-primary-bg shadow-[0_1px_0_rgba(255,255,255,0.6)_inset]">
        <svg
          className="h-9 w-9 text-primary"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <motion.path
            d="M5 12.5l4 4L19 7"
            initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
          />
        </svg>
      </div>
    </div>
  );
}
