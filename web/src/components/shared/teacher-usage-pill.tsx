"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { billing } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

/**
 * Daily-cap meter for the independent free teacher tier. Renders
 * `X / 10 today` and links to /pricing?view=teacher. Hides itself
 * entirely when the backend says the user bypasses the cap (school
 * teacher on an active school, Pro tier, or settings.bypass_subscription).
 *
 * Pro / school teachers should never see this pill, so we double-gate:
 * first by client-side role/subscription_tier (cheap), then by the
 * server's `bypass` flag (authoritative).
 *
 * `compact` drops the "Free plan" label and the sidebar margins so
 * the pill fits in the mobile header bar.
 */
export function TeacherUsagePill({ compact = false }: { compact?: boolean }) {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<{ used: number; limit: number; bypass: boolean } | null>(null);

  // Client-side fast gate. Skip the fetch entirely for the obvious
  // non-cases — saves a round-trip on every nav for users who could
  // never see the pill anyway.
  const couldBeGated =
    user?.role === "teacher" &&
    user.subscription_tier === "free" &&
    !user.school_id;

  useEffect(() => {
    if (!couldBeGated) return;
    let cancelled = false;
    billing.teacherUsage()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        // Pill is informational — silent failure is fine here. Worst
        // case the teacher just doesn't see a counter for this session.
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [couldBeGated]);

  if (!couldBeGated || !data || data.bypass) return null;

  const { used, limit } = data;
  const near = used >= limit - 2;          // visual warning at 8+/10
  const hit = used >= limit;               // visual hard-stop at 10/10

  const toneClasses = hit
    ? "border-error/40 bg-error/10 text-error hover:bg-error/15"
    : near
      ? "border-amber-500/40 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300"
      : "border-border-light bg-surface-alt text-text-secondary hover:border-primary/40 hover:text-primary";

  if (compact) {
    return (
      <Link
        href="/pricing?view=teacher"
        title="Free teacher plan — 10 AI problem generations per day. Click to upgrade."
        className={`rounded-[--radius-pill] border px-2.5 py-1 text-[11px] font-semibold tabular-nums transition-colors ${toneClasses}`}
      >
        {used} / {limit}
      </Link>
    );
  }

  return (
    <Link
      href="/pricing?view=teacher"
      title="Free teacher plan — 10 AI problem generations per day. Click to upgrade."
      className={`mx-3 mb-2 flex items-center justify-between gap-2 rounded-[--radius-sm] border px-3 py-2 text-xs font-semibold transition-colors ${toneClasses}`}
    >
      <span>Free plan</span>
      <span className="tabular-nums">
        {used} / {limit} today
      </span>
    </Link>
  );
}
