"use client";

import { useEffect } from "react";
import { PageErrorState } from "@/components/ui";
import "./globals.css";

/**
 * Last-resort boundary for a throw in the root layout itself. Next replaces
 * the whole document here, so this owns its own <html>/<body> and pulls in
 * globals.css for the branded PageErrorState. Fires only when the root
 * layout crashes — per-page throws are caught by the closer (app)/error.tsx
 * boundary and keep the app shell. `reset()` re-renders without a reload.
 */
export default function GlobalError({
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
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col items-center justify-center font-sans">
        <PageErrorState
          title="Something went wrong"
          message="The app ran into an unexpected error. Try again — if it keeps happening, reload the page."
          onRetry={reset}
        />
      </body>
    </html>
  );
}
