"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";

/**
 * Redirects to /login if no authenticated user.
 * Shows a loading state while checking auth.
 *
 * When the session ended mid-use (see onSessionEnded), the sign-in page
 * says so and brings them back to this page afterwards.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading, sessionEnded } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (loading || user) return;
    if (sessionEnded) {
      const here = window.location.pathname + window.location.search;
      router.replace(`/login?reason=signed_out&redirect=${encodeURIComponent(here)}`);
    } else {
      router.replace("/login");
    }
  }, [user, loading, sessionEnded, router]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
