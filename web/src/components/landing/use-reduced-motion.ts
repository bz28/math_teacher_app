import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * prefers-reduced-motion, hydration-safe. framer-motion's useReducedMotion
 * reads the media query during the first client render, so a reduced-motion
 * visitor's first render differed from the server HTML and React threw a
 * hydration error and re-rendered the demo. Here the server value (false)
 * is used for hydration, then the real value on the next render.
 */
export function useReducedMotionSafe(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
