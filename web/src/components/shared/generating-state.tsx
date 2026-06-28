"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GeneratingStateProps {
  /** The editorial headline. Pass JSX so the site can italicize its accent
   *  word, e.g. <>Composing your <em className="...">exam…</em></>. */
  message: ReactNode;
  /** A warm, honest one-liner about the wait. */
  subtext?: string;
  className?: string;
}

/**
 * The branded "composing" state — a calm, dignified beat for the app's
 * longest AI generations (photo OCR, exam composition, practice building).
 *
 * A deep-green seal breathes at the center while three editorial shimmer
 * lines settle into place beneath an Instrument-Serif headline — turning
 * dead time into anticipation rather than a bare spinner. Fully
 * reduced-motion safe: with motion off, the seal sits still and lit and the
 * shimmer holds steady, so the message stays a composed statement, never a
 * frozen spinner.
 */
export function GeneratingState({ message, subtext, className }: GeneratingStateProps) {
  const reduce = useReducedMotion();

  return (
    <div
      className={cn(
        "mx-auto flex max-w-md flex-col items-center gap-6 py-16 text-center sm:py-20",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {/* The breathing seal — a quiet pulse of green, not a spin. */}
      <div className="relative h-20 w-20" aria-hidden>
        {/* Sonar ripple — one calm ring expanding outward. */}
        {!reduce && (
          <motion.span
            className="absolute inset-0 rounded-full border border-primary/30"
            initial={{ opacity: 0.5, scale: 0.85 }}
            animate={{ opacity: 0, scale: 1.4 }}
            transition={{ duration: 2.4, ease: "easeOut", repeat: Infinity }}
          />
        )}
        {/* Soft halo that breathes behind the disc. */}
        <motion.span
          className="absolute inset-0 rounded-full bg-primary/10 blur-md"
          initial={reduce ? { opacity: 0.55 } : { opacity: 0.35, scale: 0.92 }}
          animate={reduce ? { opacity: 0.55 } : { opacity: [0.35, 0.6, 0.35], scale: [0.92, 1.06, 0.92] }}
          transition={reduce ? undefined : { duration: 2.4, ease: "easeInOut", repeat: Infinity }}
        />
        {/* The cream disc inside its deep-green ring. */}
        <div className="relative flex h-full w-full items-center justify-center rounded-full border border-primary/25 bg-primary-bg shadow-[0_1px_0_rgba(255,255,255,0.6)_inset]">
          <motion.span
            className="h-3 w-3 rounded-full bg-primary"
            initial={reduce ? { opacity: 0.85 } : { opacity: 0.5, scale: 0.85 }}
            animate={reduce ? { opacity: 0.85 } : { opacity: [0.5, 1, 0.5], scale: [0.85, 1, 0.85] }}
            transition={reduce ? undefined : { duration: 2.4, ease: "easeInOut", repeat: Infinity }}
          />
        </div>
      </div>

      <div>
        <h1 className="font-serif text-[2rem] leading-[1.1] text-text-primary sm:text-[2.25rem]">
          {message}
        </h1>
        {subtext && <p className="mt-3 text-sm text-text-muted">{subtext}</p>}
      </div>

      {/* Three editorial shimmer lines — content settling into place. */}
      <div className="flex w-full max-w-xs flex-col items-center gap-2.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className={cn(
              "h-2.5 rounded-full bg-primary/15",
              i === 0 ? "w-full" : i === 1 ? "w-5/6" : "w-2/3",
            )}
            initial={reduce ? { opacity: 0.4 } : { opacity: 0.25 }}
            animate={reduce ? { opacity: 0.4 } : { opacity: [0.25, 0.6, 0.25] }}
            transition={
              reduce
                ? undefined
                : { duration: 1.8, ease: "easeInOut", repeat: Infinity, delay: i * 0.22 }
            }
          />
        ))}
      </div>
    </div>
  );
}
