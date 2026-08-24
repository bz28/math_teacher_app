"use client";

import { useEffect } from "react";
import { PageErrorState } from "@/components/ui";
import { reportClientError } from "@/lib/report-error";

/**
 * Route-group error boundary for the authenticated app. A render throw in
 * any (app) page is caught here and swapped for the branded PageErrorState,
 * still wrapped in the app shell (nav + chrome from the (app) layout, which
 * stays mounted above this segment). `reset()` re-renders the segment in
 * place — no full reload.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    // THIS is where render crashes for the authenticated app land — not
    // the `ErrorBoundary` component, which is mounted in exactly one
    // place. Without this line the branded retry card below is all that
    // ever happens: the teacher sees it, and we hear nothing.
    //
    // React routes boundary-caught errors to onCaughtError and does NOT
    // re-throw them, so the window listeners cannot pick these up either.
    // The boundary has to report for itself.
    reportClientError({
      kind: "render",
      message: error.message || String(error),
      stack: error.stack,
      // Next's digest is the only handle linking this to the server-side
      // log for an error thrown during SSR.
      context: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  return (
    <PageErrorState
      message="This page ran into an unexpected error. Try again — if it keeps happening, head back and reload."
      onRetry={reset}
    />
  );
}
