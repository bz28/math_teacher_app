"use client";

import { useEffect } from "react";
import { PageErrorState } from "@/components/ui";

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
  }, [error]);

  return (
    <PageErrorState
      message="This page ran into an unexpected error. Try again — if it keeps happening, head back and reload."
      onRetry={reset}
    />
  );
}
