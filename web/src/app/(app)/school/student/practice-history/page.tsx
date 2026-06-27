"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import {
  schoolStudent,
  type PracticeActivitySetSummary,
  type StudentPracticeActivityResponse,
} from "@/lib/api";
import { formatRelativeDate } from "@/lib/utils";

/**
 * "Your practice" — the student's own formative-practice history.
 *
 * Editorial, warm, reassuring: a serif headline, four headline stats,
 * then recent activity grouped by practice set with a per-set outcome
 * breakdown. This is a record-of-effort surface, never a grade view —
 * the copy leans into "your effort shows up here," not "your score."
 *
 * Reads GET /school/student/practice/activity (totals + per-set rollup,
 * newest set first). Refetches on tab focus so a session finished in
 * another tab surfaces on return, mirroring the grades/dashboard pages.
 */
export default function PracticeHistoryPage() {
  const [data, setData] = useState<StudentPracticeActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotion();

  const load = useCallback(() => {
    schoolStudent
      .practiceActivity()
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch(() => setError("Couldn't load your practice. Please try again."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <p className="text-error">{error}</p>
        <button
          type="button"
          onClick={load}
          className="mt-4 rounded-[--radius-sm] border border-border px-4 py-2 text-sm font-semibold text-text-primary hover:bg-surface-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  if (data === null) {
    return <PracticeHistorySkeleton />;
  }

  const empty = data.problems_practiced === 0 && data.learn_walkthroughs === 0;
  const firstTryPct =
    data.first_try_rate === null ? null : Math.round(data.first_try_rate * 100);

  // Motion respects reduced-motion: collapse to instant when set.
  const container: Variants = {
    hidden: {},
    show: {
      transition: { staggerChildren: reduce ? 0 : 0.06, delayChildren: reduce ? 0 : 0.04 },
    },
  };
  const item: Variants = reduce
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
      };

  return (
    <motion.div
      className="mx-auto max-w-3xl"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Editorial header */}
      <motion.div variants={item} className="mb-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          Your practice
        </p>
        <h1 className="mt-2 font-serif text-[2.5rem] leading-[1.05] tracking-[-0.01em] text-text-primary">
          Where your effort shows up
        </h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-text-secondary">
          A private record of the problems you&rsquo;ve worked through. Ungraded
          by design — your teacher sees that you&rsquo;re practicing, never your
          answers.
        </p>
      </motion.div>

      {empty ? (
        <motion.div variants={item}>
          <EmptyState />
        </motion.div>
      ) : (
        <>
          {/* Headline stats */}
          <motion.div
            variants={item}
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            <Stat
              label="Problems practiced"
              value={String(data.problems_practiced)}
            />
            <Stat
              label="First-try rate"
              value={firstTryPct === null ? "—" : `${firstTryPct}%`}
            />
            <Stat
              label="Walkthroughs"
              value={String(data.learn_walkthroughs)}
            />
            <Stat
              label="Last active"
              value={
                data.last_active ? formatRelativeDate(data.last_active) : "—"
              }
              small
            />
          </motion.div>

          {/* Recent activity, grouped by set */}
          <motion.div variants={item} className="mt-10">
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
              Recent practice sets
            </h2>
            <div className="space-y-3">
              {data.sets.map((set) => (
                <SetCard key={set.practice_assignment_id} set={set} />
              ))}
            </div>
          </motion.div>
        </>
      )}
    </motion.div>
  );
}

function Stat({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-[--radius-xl] border border-border-light bg-surface p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
        {label}
      </div>
      <div
        className={
          "mt-1.5 font-serif tabular-nums text-text-primary " +
          (small ? "text-2xl" : "text-[2rem] leading-none")
        }
      >
        {value}
      </div>
    </div>
  );
}

function SetCard({ set }: { set: PracticeActivitySetSummary }) {
  const firstTryPct =
    set.problems_practiced > 0
      ? Math.round((set.first_try_count / set.problems_practiced) * 100)
      : null;

  return (
    <Link
      href={`/school/student/courses/${set.course_id}/practice/${set.practice_assignment_id}`}
      className="group block rounded-[--radius-xl] border border-border-light bg-surface p-5 transition-colors hover:border-primary"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-text-primary group-hover:text-primary">
            {set.title}
          </div>
          <div className="mt-0.5 truncate text-xs text-text-muted">
            {set.course_name}
          </div>
        </div>
        <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-text-muted">
          {formatRelativeDate(set.last_active)}
        </span>
      </div>

      {/* Per-set outcome breakdown */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-text-secondary">
        {set.problems_practiced > 0 && (
          <Metric
            value={set.problems_practiced}
            label={set.problems_practiced === 1 ? "problem" : "problems"}
          />
        )}
        {firstTryPct !== null && (
          <Metric value={`${firstTryPct}%`} label="first try" accent />
        )}
        {set.learn_walkthroughs > 0 && (
          <Metric
            value={set.learn_walkthroughs}
            label={
              set.learn_walkthroughs === 1 ? "walkthrough" : "walkthroughs"
            }
          />
        )}
      </div>
    </Link>
  );
}

function Metric({
  value,
  label,
  accent,
}: {
  value: string | number;
  label: string;
  accent?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        className={
          "font-serif text-base tabular-nums " +
          (accent ? "text-primary" : "text-text-primary")
        }
      >
        {value}
      </span>
      <span className="text-text-muted">{label}</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle px-6 py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-bg">
        <svg
          className="h-6 w-6 text-primary"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20v-6" />
          <path d="M6 20V10" />
          <path d="M18 20V4" />
        </svg>
      </div>
      <h2 className="mt-4 font-serif text-2xl text-text-primary">
        Nothing here yet
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-muted">
        Start practicing and your progress shows up here — every problem you
        work through, kept just for you.
      </p>
    </div>
  );
}

function PracticeHistorySkeleton() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 space-y-3">
        <div className="h-3 w-24 animate-pulse rounded-[--radius-sm] bg-surface-hover" />
        <div className="h-10 w-80 animate-pulse rounded-[--radius-sm] bg-surface-hover" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-[--radius-sm] bg-surface-hover" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[88px] animate-pulse rounded-[--radius-xl] bg-surface-hover"
          />
        ))}
      </div>
      <div className="mt-10 space-y-3">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-[--radius-xl] bg-surface-hover"
          />
        ))}
      </div>
    </div>
  );
}
