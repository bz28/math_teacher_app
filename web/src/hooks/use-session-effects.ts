import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";

/**
 * Redirect to /learn when the session phase is idle and no guard value is present.
 * Used by learn/session, practice, and mock-test pages.
 */
export function useRedirectOnIdle(phase: string, guard: unknown) {
  const router = useRouter();
  useEffect(() => {
    if (phase === "idle" && !guard) {
      router.replace("/learn");
    }
  }, [phase, guard, router]);
}

/**
 * Show a toast notification when the session enters an error phase.
 * Used by learn/session, practice, and mock-test pages.
 */
export function useErrorToast(phase: string, error: string | null) {
  const toast = useToast();
  useEffect(() => {
    if (phase === "error" && error) toast.error(error);
  }, [phase, error, toast]);
}
