"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth";
import { CheckIcon } from "@/components/ui/icons";

export default function CheckoutSuccessPage() {
  const loadUser = useAuthStore((s) => s.loadUser);
  const user = useAuthStore((s) => s.user);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 6;

    async function poll() {
      await loadUser();
      attempts++;
      const currentUser = useAuthStore.getState().user;
      if (currentUser?.is_pro || attempts >= maxAttempts) {
        setReady(true);
        return;
      }
      setTimeout(poll, 1500);
    }

    poll();
  }, [loadUser]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
        <CheckIcon className="h-10 w-10 text-success" />
      </div>

      <h1 className="text-2xl font-extrabold text-text-primary">
        {ready && user?.is_pro ? "Welcome to Pro!" : "Processing your subscription..."}
      </h1>

      <p className="mt-3 text-text-secondary">
        {ready && user?.is_pro
          ? "You now have access to unlimited sessions, mock exams, work diagnosis, and more."
          : "This usually takes just a moment."}
      </p>

      {ready && (
        <Link
          href="/home"
          className="mt-8 rounded-[--radius-pill] bg-primary px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-dark"
        >
          Continue to Home
        </Link>
      )}

      {!ready && (
        <div className="mt-8 h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      )}
    </div>
  );
}
