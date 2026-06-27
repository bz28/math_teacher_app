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
 * then recent activity organized BY CLASS — the student's mental model
 * is "my classes," so each class gets its own section (name → that
 * class's effort line → a clear entry to practice → its recent sets).
 * This is a record-of-effort surface, never a grade view — the copy
 * leans into "your effort shows up here," not "your score."
 *
 * Reads GET /school/student/practice/activity (totals + per-set rollup,
 * newest set first). Every set already carries course_id + course_name,
 * so the by-class regroup is a pure frontend fold — no backend change.
 * Classes are ordered by most-recent activity (sets arrive newest-first,
 * so the first class encountered is the freshest). Refetches on tab
 * focus so a session finished in another tab surfaces on return,
 * mirroring the grades/dashboard pages.
 */

/** One class's practice activity — its sets plus rolled-up effort. */
interface ClassGroup {
  course_id: string;
  course_name: string;
  problems_practiced: number;
  first_try_count: number;
  learn_walkthroughs: number;
  /** ISO timestamp of the most recent activity across the class's sets. */
  last_active: string;
  sets: PracticeActivitySetSummary[];
}

/**
 * Fold the flat, newest-first set list into per-class groups, preserving
 * recency order. Because sets arrive newest-first, the first set seen for
 * a class fixes both the class's position and its last_active.
 */
function groupByClass(sets: PracticeActivitySetSummary[]): ClassGroup[] {
  const order: ClassGroup[] = [];
  const byId = new Map<string, ClassGroup>();
  for (const set of sets) {
    let group = byId.get(set.course_id);
    if (!group) {
      group = {
        course_id: set.course_id,
        course_name: set.course_name,
        problems_practiced: 0,
        first_try_count: 0,
        learn_walkthroughs: 0,
        last_active: set.last_active,
        sets: [],
      };
      byId.set(set.course_id, group);
      order.push(group);
    }
    group.sets.push(set);
    group.problems_practiced += set.problems_practiced;
    group.first_try_count += set.first_try_count;
    group.learn_walkthroughs += set.learn_walkthroughs;
  }
  return order;
}
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

          {/* Recent activity, organized by class */}
          <motion.div variants={item} className="mt-10">
            <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
              By class
            </h2>
            <div className="space-y-8">
              {groupByClass(data.sets).map((group) => (
                <ClassSection key={group.course_id} group={group} />
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

/**
 * One class's section: a serif class-name header with a direct entry
 * into that class's Practice tab, a compact rolled-up effort line, then
 * the class's recent practice sets. The class name is the spine — the
 * per-set card no longer repeats it, since it lives under this header.
 */
function ClassSection({ group }: { group: ClassGroup }) {
  const firstTryPct =
    group.problems_practiced > 0
      ? Math.round((group.first_try_count / group.problems_practiced) * 100)
      : null;

  return (
    <section>
      <div className="border-t border-border-light pt-4">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="min-w-0 truncate font-serif text-2xl leading-tight text-text-primary">
            {group.course_name}
          </h3>
          <Link
            href={`/school/student/courses/${group.course_id}?tab=practice`}
            className="group shrink-0 whitespace-nowrap text-xs font-semibold text-primary transition-colors hover:text-primary-dark"
          >
            Practice{" "}
            <span className="inline-block transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </Link>
        </div>

        {/* Class-level effort rollup — a quiet line, not big tiles. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-text-secondary">
          {group.problems_practiced > 0 && (
            <Metric
              value={group.problems_practiced}
              label={group.problems_practiced === 1 ? "problem" : "problems"}
            />
          )}
          {firstTryPct !== null && (
            <Metric value={`${firstTryPct}%`} label="first try" accent />
          )}
          {group.learn_walkthroughs > 0 && (
            <Metric
              value={group.learn_walkthroughs}
              label={
                group.learn_walkthroughs === 1 ? "walkthrough" : "walkthroughs"
              }
            />
          )}
          <span className="ml-auto whitespace-nowrap text-[11px] font-medium text-text-muted">
            {formatRelativeDate(group.last_active)}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {group.sets.map((set) => (
          <SetCard key={set.practice_assignment_id} set={set} />
        ))}
      </div>
    </section>
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
        <div className="min-w-0 truncate text-base font-semibold text-text-primary group-hover:text-primary">
          {set.title}
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
