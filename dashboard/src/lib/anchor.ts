import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Per-problem deep links: `#p3` means "Problem 3". Report emails and the
 * report case view link into the submission trace and the assignment
 * page this way, so an operator lands on the problem a teacher reported
 * instead of the top of a long page.
 */

/** The anchor id for a problem position — the one place it's spelled. */
export const problemAnchor = (position: number) => `p${position}`;

/** The problem the URL's hash points at, or null. */
export function useProblemHash(): number | null {
  const { hash } = useLocation();
  const m = /^#p(\d{1,3})$/.exec(hash);
  return m ? Number(m[1]) : null;
}

/**
 * Scroll the hashed problem into view once the page has rendered it.
 *
 * The browser's own hash jump fires on navigation, before these pages
 * have fetched anything — the target doesn't exist yet, so it silently
 * does nothing. This waits for `ready` and then scrolls. When the problem
 * has no element (the reader found nothing for it), it lands on
 * `fallbackId` rather than leaving the operator at the top wondering
 * whether the link worked.
 */
export function useScrollToProblem(problem: number | null, ready: boolean, fallbackId?: string) {
  useEffect(() => {
    if (problem === null || !ready) return;
    const el =
      document.getElementById(problemAnchor(problem)) ??
      (fallbackId ? document.getElementById(fallbackId) : null);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [problem, ready, fallbackId]);
}
