"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { homePathFor } from "@/lib/home-path";
import { useAuthStore } from "@/stores/auth";

/**
 * Layout for the hidden self-study routes. Their pages stay in the codebase
 * (the school practice flow shares the same AI core), but nobody reaches
 * them: every visit is sent to the user's portal instead.
 */
export function SelfStudyClosed() {
  const router = useRouter();
  const { user, loading } = useAuthStore();

  useEffect(() => {
    if (loading || !user) return;
    router.replace(homePathFor(user.role));
  }, [user, loading, router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
