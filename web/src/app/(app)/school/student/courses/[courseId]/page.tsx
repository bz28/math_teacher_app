"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  schoolStudent,
  type StudentHomeworkSummary,
  type StudentPracticeSummary,
} from "@/lib/api";

type TabKey = "homework" | "practice";
const TABS: { key: TabKey; label: string }[] = [
  { key: "homework", label: "Homework" },
  { key: "practice", label: "Practice" },
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
        {tab === "homework" ? (
          <HomeworkList courseId={courseId} />
        ) : (
          <PracticeList courseId={courseId} />
        )}
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
          after you&rsquo;ve turned in a HW and see if there&rsquo;s something
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
