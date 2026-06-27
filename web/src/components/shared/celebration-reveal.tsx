"use client";

import { useReducedMotion, type Variants } from "framer-motion";

/**
 * The shared entrance for the app's payoff / celebration surfaces
 * (a solved problem, a finished practice set, a completed exam). One
 * orchestrated reveal — a gentle, blur-lifted upward settle, staggered
 * top-to-bottom — so the reward reads as a single composed moment
 * rather than a scatter of micro-animations. Restraint over confetti.
 *
 * Respects `prefers-reduced-motion`: with motion off the composition is
 * simply present (full opacity, no transform) and still beautiful.
 *
 * Usage: spread `container` on the wrapping motion element with
 * `initial="hidden" animate="show"`, and `item` on each child that
 * should reveal in sequence.
 */
export function useCelebrationReveal(): { container: Variants; item: Variants } {
  const reduce = useReducedMotion();

  const container: Variants = {
    hidden: {},
    show: {
      transition: reduce ? {} : { staggerChildren: 0.09, delayChildren: 0.08 },
    },
  };

  const item: Variants = reduce
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: "0.55em", filter: "blur(6px)" },
        show: {
          opacity: 1,
          y: "0em",
          filter: "blur(0px)",
          transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
        },
      };

  return { container, item };
}
