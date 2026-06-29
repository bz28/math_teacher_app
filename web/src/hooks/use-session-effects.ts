import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Redirect to /learn when the session phase is idle and no guard value is present.
 * Used by learn/session, practice, and mock-test pages.
 *
 * Generation-failure surfacing lives inline on each page now (a branded
 * PageErrorState), not a toast — one honest surface per failure instead
 * of a red banner plus a duplicate toast.
 */
export function useRedirectOnIdle(phase: string, guard: unknown) {
  const router = useRouter();
  useEffect(() => {
    if (phase === "idle" && !guard) {
      router.replace("/learn");
    }
  }, [phase, guard, router]);
}
