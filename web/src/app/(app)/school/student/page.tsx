"use client";

import { useCallback, useEffect, useState } from "react";
import {
  schoolStudent,
  type StudentDashboardResponse,
} from "@/lib/api";
import { DashboardCard } from "@/components/school/student/dashboard-card";
import { DashboardAssignmentRow } from "@/components/school/student/dashboard-assignment-row";
import { StudentGradeRow } from "@/components/school/student/student-grade-row";

/**
 * Student Today dashboard. Top of the school-student portal — what
 * they land on. Three visual tiers:
 *   1. Greeting + (optional) "In review" status line.
 *   2. Due this week card (Overdue rendered inline, red subsection).
 *   3. Recently graded card.
 *
 * Single round trip via /dashboard. Refetches on window focus so a
 * grade published in a background tab appears when the student
 * switches back.
 */
export default function SchoolStudentDashboard() {
  const [data, setData] = useState<StudentDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    schoolStudent
      .getDashboard()
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch(() => setError("Couldn't load your dashboard. Please try again."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Revalidate when the student comes back to the tab — covers the
  // "teacher just published my grade, I tab back, I see it" flow
  // without introducing SWR / React Query.
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
    return <DashboardSkeleton />;
  }

  const { first_name, due_this_week, overdue, in_review, recently_graded } = data;
  const dueCount = due_this_week.length + overdue.length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="dashboard-card-enter">
        <Greeting firstName={first_name} />

        {in_review.length > 0 && (
          <p className="mb-6 text-sm text-text-secondary">
            <span className="font-semibold text-text-primary">
              {in_review.length}{" "}
              {in_review.length === 1 ? "assignment" : "assignments"}
            </span>{" "}
            submitted — waiting for your teacher.
          </p>
        )}
      </div>

      <div className="space-y-6">
        <div className="dashboard-card-enter" style={{ animationDelay: "80ms" }}>
          <DashboardCard title="Due this week" count={dueCount}>
            {overdue.length > 0 && (
              <div className="border-b border-error/30 bg-error-light/40 px-5 py-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-error">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Overdue ({overdue.length})
                </div>
              </div>
            )}
            {overdue.map((a) => (
              <DashboardAssignmentRow key={`ov-${a.assignment_id}`} assignment={a} />
            ))}
            {due_this_week.map((a) => (
              <DashboardAssignmentRow key={`due-${a.assignment_id}`} assignment={a} />
            ))}
            {dueCount === 0 && (
              <EmptyRow text="You're all caught up — nothing due this week." />
            )}
          </DashboardCard>
        </div>

        <div className="dashboard-card-enter" style={{ animationDelay: "160ms" }}>
          <DashboardCard
            title="Recently graded"
            count={recently_graded.length || undefined}
          >
            {recently_graded.map((g) => (
              <StudentGradeRow key={g.assignment_id} grade={g} variant="compact" />
            ))}
            {recently_graded.length === 0 && (
              <EmptyRow text="No graded work yet. Once your teacher publishes, scores show up here." />
            )}
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}

function Greeting({ firstName }: { firstName: string }) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const greeting = timeOfDayGreeting();
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-bold tracking-tight text-text-primary">
        {greeting}
        {firstName ? `, ${firstName}` : ""}
      </h1>
      <p className="mt-1 text-sm text-text-muted">{today}</p>
    </div>
  );
}

function timeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Hello";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="px-5 py-8 text-center text-sm text-text-muted">{text}</div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 space-y-2">
        <div className="h-8 w-64 animate-pulse rounded-[--radius-sm] bg-surface-hover" />
        <div className="h-4 w-40 animate-pulse rounded-[--radius-sm] bg-surface-hover" />
      </div>
      <div className="space-y-6">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="overflow-hidden rounded-[--radius-xl] border border-border-light bg-surface"
          >
            <div className="border-b border-border-light px-5 py-3">
              <div className="h-3 w-24 animate-pulse rounded-[--radius-sm] bg-surface-hover" />
            </div>
            <div className="space-y-3 px-5 py-4">
              {[0, 1, 2].map((j) => (
                <div
                  key={j}
                  className="h-10 animate-pulse rounded-[--radius-sm] bg-surface-hover"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
