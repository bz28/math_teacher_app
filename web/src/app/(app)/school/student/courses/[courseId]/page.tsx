"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  schoolStudent,
  type CourseHistorySummary,
  type HistoryHeatmapDay,
  type HistoryReviewItem,
  type HistorySetBreakdown,
  type MasteryState,
  type StudentHomeworkSummary,
  type StudentPracticeSummary,
} from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";

type TabKey = "homework" | "practice" | "history";
const TABS: { key: TabKey; label: string }[] = [
  { key: "homework", label: "Homework" },
  { key: "practice", label: "Practice" },
  { key: "history", label: "History" },
];
const DEFAULT_TAB: TabKey = "homework";

export default function ClassDetail() {
  // useSearchParams opts the route into dynamic rendering — wrap in
  // Suspense so the client hydrates cleanly without a missing-boundary
  // warning.
  return (
    <Suspense>
      <ClassDetailInner />
    </Suspense>
  );
}

function ClassDetailInner() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === tabParam)
    ? (tabParam as TabKey)
    : DEFAULT_TAB;
  const setTab = useCallback(
    (next: TabKey) => {
      const qs = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_TAB) qs.delete("tab");
      else qs.set("tab", next);
      const q = qs.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/school/student"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary"
      >
        ← Back to classes
      </Link>

      <div className="mt-3 flex gap-1 overflow-x-auto border-b border-border-light">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`relative shrink-0 px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.key ? "text-primary" : "text-text-muted hover:text-text-primary"
            }`}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "homework" && <HomeworkList courseId={courseId} />}
        {tab === "practice" && <PracticeList courseId={courseId} />}
        {tab === "history" && <HistoryTab courseId={courseId} />}
      </div>
    </div>
  );
}

function HomeworkList({ courseId }: { courseId: string }) {
  const [homework, setHomework] = useState<StudentHomeworkSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    schoolStudent
      .listHomework(courseId)
      .then(setHomework)
      .catch(() => setError("Couldn't load your homework. Please try again."));
  }, [courseId]);

  if (error) return <p className="py-6 text-center text-error">{error}</p>;
  if (homework === null)
    return <p className="py-6 text-center text-text-muted">Loading…</p>;
  if (homework.length === 0) {
    return (
      <p className="mt-2 text-text-secondary">
        No homework has been assigned yet. Check back soon.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {homework.map((hw) => (
        <Link
          key={hw.assignment_id}
          href={`/school/student/courses/${courseId}/homework/${hw.assignment_id}`}
          className="group rounded-[--radius-md] border border-border bg-surface p-5 transition-colors hover:border-primary"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-base font-semibold text-text-primary group-hover:text-primary">
                {hw.title}
              </div>
              <div className="mt-1 text-sm text-text-secondary">
                {hw.problem_count}{" "}
                {hw.problem_count === 1 ? "problem" : "problems"}
                {hw.due_at
                  ? ` · Due ${new Date(hw.due_at).toLocaleDateString()}`
                  : ""}
              </div>
            </div>
            {hw.status === "submitted" ? (
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-600 dark:bg-green-500/10">
                Submitted ✓
              </span>
            ) : (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:bg-amber-500/10">
                Not started
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

function PracticeList({ courseId }: { courseId: string }) {
  const [practice, setPractice] = useState<StudentPracticeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    schoolStudent
      .listPractice(courseId)
      .then(setPractice)
      .catch(() => setError("Couldn't load practice. Please try again."));
  }, [courseId]);

  if (error) return <p className="py-6 text-center text-error">{error}</p>;
  if (practice === null)
    return <p className="py-6 text-center text-text-muted">Loading…</p>;
  if (practice.length === 0) {
    return (
      <div className="mt-4 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-8 text-center">
        <p className="text-sm font-semibold text-text-primary">
          No practice sets yet
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Your teacher publishes practice sets alongside homework. Come back
          after you&rsquo;ve turned in a homework and see if there&rsquo;s something
          ready here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {practice.map((p) => (
        <Link
          key={p.assignment_id}
          href={`/school/student/courses/${courseId}/practice/${p.assignment_id}`}
          className="group rounded-[--radius-md] border border-border bg-surface p-5 transition-colors hover:border-primary"
        >
          <div className="min-w-0">
            <div className="text-base font-semibold text-text-primary group-hover:text-primary">
              {p.title}
            </div>
            <div className="mt-1 text-sm text-text-secondary">
              {p.problem_count}{" "}
              {p.problem_count === 1 ? "problem" : "problems"}
              {" · Ungraded"}
            </div>
            {p.source_homework_title && (
              <div className="mt-1.5 text-[11px] text-text-muted">
                Cloned from{" "}
                <span className="font-medium text-text-secondary">
                  {p.source_homework_title}
                </span>
              </div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

// ── History tab ──
//
// The third tab — per-class study record. Heatmap of activity in
// this class, mastery aggregates, current streak, "needs review"
// queue, and per-set progress. Loads in one round trip; renders all
// sections from the same summary payload.

function HistoryTab({ courseId }: { courseId: string }) {
  const [summary, setSummary] = useState<CourseHistorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    schoolStudent
      .courseHistorySummary(courseId)
      .then(setSummary)
      .catch(() => setError("Couldn't load your study record."));
  }, [courseId]);

  if (error) return <p className="py-6 text-center text-error">{error}</p>;
  if (summary === null)
    return <p className="py-6 text-center text-text-muted">Loading…</p>;

  // Brand-new student in this class: no practice attempted yet.
  // Keep the page focused on the call-to-action rather than empty
  // stats blocks.
  if (summary.total_problems === 0 && summary.sets.length === 0) {
    return (
      <div className="mt-4 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-8 text-center">
        <p className="text-sm font-semibold text-text-primary">
          Your study record starts here.
        </p>
        <p className="mt-1 text-xs text-text-muted">
          When your teacher publishes practice sets, your activity will show
          up on this tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <HistoryHeader summary={summary} />
      <HeatmapPanel days={summary.heatmap} />
      {summary.needs_review.length > 0 && (
        <NeedsReviewPanel courseId={courseId} items={summary.needs_review} />
      )}
      {summary.sets.length > 0 && <SetsBreakdownPanel sets={summary.sets} courseId={courseId} />}
    </div>
  );
}

function HistoryHeader({ summary }: { summary: CourseHistorySummary }) {
  const pct =
    summary.total_problems > 0
      ? (summary.mastered_count / summary.total_problems) * 100
      : 0;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-[--radius-md] border border-border-light bg-surface p-5 sm:col-span-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-text-muted">
          Mastered in this class
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-4xl font-extrabold tracking-tight text-primary">
            {summary.mastered_count}
          </span>
          <span className="text-base italic text-text-muted">of</span>
          <span className="text-2xl font-bold text-text-secondary">
            {summary.total_problems}
          </span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ type: "spring", stiffness: 80, damping: 18 }}
          />
        </div>
      </div>
      <div className="rounded-[--radius-md] border border-border-light bg-surface p-5">
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-text-muted">
          Current streak
        </div>
        <div className="mt-2 text-4xl font-extrabold tracking-tight text-text-primary">
          {summary.streak_days}{" "}
          <span className="text-xl font-semibold italic text-text-muted">
            {summary.streak_days === 1 ? "day" : "days"}
          </span>
        </div>
        <div className="mt-2 text-xs text-text-secondary">
          {summary.streak_days === 0
            ? "Study today to start a streak."
            : "Studied at least one problem each day."}
        </div>
      </div>
    </div>
  );
}

// ── Heatmap ──
//
// GitHub-style activity grid for the last 20 weeks. Each cell is one
// UTC day; intensity bins are quartiles of the observed counts. We
// always render 20 weeks even if some are empty so the grid is a
// stable shape (no jumpy width as activity grows).

const HEATMAP_WEEKS = 20;
const HEATMAP_DAYS = HEATMAP_WEEKS * 7;

function HeatmapPanel({ days }: { days: HistoryHeatmapDay[] }) {
  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days) m.set(d.date, d.count);
    return m;
  }, [days]);

  // Build a window of HEATMAP_DAYS, oldest first, with counts mapped
  // in. The grid renders column-by-column (Sunday on top), so we
  // shape the array of cells with date metadata for tooltips.
  const cells = useMemo(() => {
    const result: { date: string; count: number }[] = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      result.push({ date: iso, count: byDate.get(iso) ?? 0 });
    }
    return result;
  }, [byDate]);

  // Bin intensities so a single big day doesn't drown out everything
  // else. Four bins is the consumer convention.
  const maxCount = Math.max(1, ...cells.map((c) => c.count));
  const bin = (n: number) => {
    if (n === 0) return 0;
    if (n <= Math.ceil(maxCount * 0.25)) return 1;
    if (n <= Math.ceil(maxCount * 0.5)) return 2;
    if (n <= Math.ceil(maxCount * 0.75)) return 3;
    return 4;
  };

  return (
    <div className="rounded-[--radius-md] border border-border-light bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-bold text-text-primary">
          Last {HEATMAP_WEEKS} weeks
        </h3>
        <div className="hidden items-center gap-1.5 text-[10px] text-text-muted sm:flex">
          <span>less</span>
          {[0, 1, 2, 3, 4].map((b) => (
            <span
              key={b}
              className={cn("h-2.5 w-2.5 rounded-[2px]", BIN_COLOR[b])}
            />
          ))}
          <span>more</span>
        </div>
      </div>
      <div
        className="mt-4 grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${HEATMAP_WEEKS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: HEATMAP_WEEKS }).map((_, weekIdx) => (
          <div key={weekIdx} className="flex flex-col gap-[3px]">
            {cells
              .slice(weekIdx * 7, (weekIdx + 1) * 7)
              .map((c) => (
                <div
                  key={c.date}
                  title={`${c.date} · ${c.count} ${c.count === 1 ? "attempt" : "attempts"}`}
                  className={cn("aspect-square rounded-[2px]", BIN_COLOR[bin(c.count)])}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const BIN_COLOR: Record<number, string> = {
  0: "bg-bg-subtle",
  1: "bg-primary/25",
  2: "bg-primary/50",
  3: "bg-primary/75",
  4: "bg-primary",
};

// ── Needs review ──

const REVIEW_BADGE: Record<MasteryState, { label: string; cls: string } | null> = {
  not_started: null,
  mastered: null,
  walked_through: {
    label: "Walked through",
    cls: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
  },
  attempted: {
    label: "Attempted",
    cls: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
  },
  missed: {
    label: "Got wrong",
    cls: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300",
  },
};

function NeedsReviewPanel({
  courseId,
  items,
}: {
  courseId: string;
  items: HistoryReviewItem[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-base font-bold text-text-primary">
          Worth a second look
        </h3>
        <span className="text-xs italic text-text-muted">
          problems you might want to revisit before the next test
        </span>
      </div>
      <div className="overflow-hidden rounded-[--radius-md] border border-border-light bg-surface">
        {items.map((it, i) => {
          const badge = REVIEW_BADGE[it.mastery_state];
          return (
            <Link
              key={it.bank_item_id}
              href={`/school/student/courses/${courseId}/practice/${it.practice_assignment_id}/session?start=${it.bank_item_id}`}
              className={cn(
                "group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-bg-subtle/60",
                i !== items.length - 1 && "border-b border-border-light",
              )}
            >
              {badge && (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
                    badge.cls,
                  )}
                >
                  {badge.label}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="line-clamp-1 text-sm font-medium text-text-primary">
                  <MathText text={it.question} />
                </div>
                <div className="mt-0.5 text-[11px] text-text-muted">
                  {it.practice_title}
                </div>
              </div>
              <span
                aria-hidden
                className="text-base text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
              >
                →
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Per-set breakdown ──

function SetsBreakdownPanel({
  sets,
  courseId,
}: {
  sets: HistorySetBreakdown[];
  courseId: string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-base font-bold text-text-primary">
        Per-set progress
      </h3>
      <div className="grid gap-2">
        {sets.map((s) => {
          const pct =
            s.problem_count > 0
              ? Math.round((s.mastered_count / s.problem_count) * 100)
              : 0;
          return (
            <Link
              key={s.assignment_id}
              href={`/school/student/courses/${courseId}/practice/${s.assignment_id}`}
              className="group flex items-center gap-3 rounded-[--radius-md] border border-border-light bg-surface px-4 py-3 transition-colors hover:border-primary"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-text-primary group-hover:text-primary">
                  {s.title}
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div className="text-xs tabular-nums text-text-secondary">
                <span className="font-bold text-text-primary">
                  {s.mastered_count}
                </span>
                <span className="text-text-muted"> / {s.problem_count}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
