"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth";
import { CheckIcon } from "@/components/ui/icons";

// Flag the workspace shell checks on mount to force a one-time
// /auth/me refetch even after this page gives up polling. Belt-and-
// suspenders for the "webhook arrives ~minutes late" case where the
// user reaches /school/teacher with stale tier=free.
const PENDING_FLAG_KEY = "veradic_pending_pro_activation";

export default function CheckoutSuccessPage() {
  const loadUser = useAuthStore((s) => s.loadUser);
  const user = useAuthStore((s) => s.user);
  const [ready, setReady] = useState(false);
  // Distinguishes "Pro confirmed in this session" (happy path) from
  // "we gave up polling; the upgrade is probably still processing"
  // (slow-webhook path). Drives the headline + microcopy.
  const [proConfirmed, setProConfirmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    // Stripe webhook delivery in healthy regions is < 10s p99; we
    // extend to 30s (20 × 1.5s) to cover transient blips. Beyond
    // that we hand off to the workspace's refetch-on-mount fallback
    // rather than blocking the user here indefinitely.
    const maxAttempts = 20;
    if (typeof window !== "undefined") {
      sessionStorage.setItem(PENDING_FLAG_KEY, "1");
    }

    async function poll() {
      if (cancelled) return;
      await loadUser();
      attempts++;
      const currentUser = useAuthStore.getState().user;
      if (cancelled) return;
      if (currentUser?.is_pro) {
        setProConfirmed(true);
        setReady(true);
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(PENDING_FLAG_KEY);
        }
        return;
      }
      if (attempts >= maxAttempts) {
        // Timed out — flag stays so the workspace shell can pick up
        // the activation when it eventually lands.
        setReady(true);
        return;
      }
      setTimeout(poll, 1500);
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [loadUser]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
        <CheckIcon className="h-10 w-10 text-success" />
      </div>

      <h1 className="text-2xl font-extrabold text-text-primary">
        {ready
          ? proConfirmed
            ? "Welcome to Pro!"
            : "Almost there..."
          : "Processing your subscription..."}
      </h1>

      <p className="mt-3 text-text-secondary">
        {ready
          ? proConfirmed
            ? user?.role === "teacher"
              ? "Unlimited AI problem generation, grading drafts, and reusable banks — no daily cap."
              : "You now have access to unlimited sessions, mock exams, work diagnosis, and more."
            : "Your payment went through — your subscription will activate within a few minutes. You can continue using the app now; Pro features will switch on automatically when it's ready."
          : "This usually takes just a moment."}
      </p>

      {ready && (
        <Link
          href={user?.role === "teacher" ? "/school/teacher" : "/home"}
          className="mt-8 rounded-[--radius-pill] bg-primary px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-dark"
        >
          {user?.role === "teacher" ? "Continue to Workspace" : "Continue to Home"}
        </Link>
      )}

      {!ready && (
        <div className="mt-8 h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      )}
    </div>
  );
}
