"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  schoolStudent,
  type StudentDashboardResponse,
  type StudentClassSummary,
} from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { TOUR_IDS, useTour } from "@/components/tour";
import { DashboardCard } from "@/components/school/student/dashboard-card";
import { DashboardAssignmentRow } from "@/components/school/student/dashboard-assignment-row";
import { StudentGradeRow } from "@/components/school/student/student-grade-row";
import { SidebarJoinModal } from "@/components/school/student/sidebar-join-modal";
import { Button, PageErrorState } from "@/components/ui";

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
  // Class list drives the zero-classes onboarding branch. Same API the
  // sidebar uses (schoolStudent.listClasses). `null` = not loaded yet.
  const [classes, setClasses] = useState<StudentClassSummary[] | null>(null);
  // Distinguishes "fetch failed" from "genuinely zero classes" — without it, a
  // transient listClasses error would falsely show the join-a-class onboarding
  // to an already-enrolled student and hide their real dashboard.
  const [classesError, setClassesError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJoin, setShowJoin] = useState(false);

  const load = useCallback(() => {
    schoolStudent
      .getDashboard()
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch(() => setError("Couldn't load your dashboard. Please try again."));
  }, []);

  const loadClasses = useCallback(() => {
    schoolStudent
      .listClasses()
      .then((c) => {
        setClasses(c);
        setClassesError(false);
      })
      .catch(() => {
        // Resolve to exit the skeleton, but mark the error so we DON'T mistake
        // it for a zero-classes student — fall through to the normal dashboard.
        setClasses([]);
        setClassesError(true);
      });
  }, []);

  useEffect(() => {
    load();
    loadClasses();
  }, [load, loadClasses]);

  // Revalidate when the student comes back to the tab — covers the
  // "teacher just published my grade, I tab back, I see it" flow
  // without introducing SWR / React Query.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        load();
        loadClasses();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load, loadClasses]);

  // ── First-run onboarding tour ──
  // A school student lands here once they've joined a class (the join is
  // what stamps school_id). This is their home base, so it's where the
  // Field Guide tour auto-starts — a pure spotlight walk, no handoffs.
  // Mirror the teacher auto-start guards: latch once, never restart a
  // live tour, gate on persona + tours_seen. Skip preview shadows
  // (a teacher previewing as a student) — their tours_seen is the teacher's.
  const tour = useTour();
  const user = useAuthStore((s) => s.user);
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (tour.isActive) return;
    if (!user || user.role !== "student" || user.is_preview) return;
    if (user.tours_seen.includes("student")) return;
    // The spotlight is a desktop experience — its targets live in the
    // md+ sidebar (width 0 on phones). Don't auto-start on mobile; the
    // "Take the tour" re-entry still works at any width.
    if (typeof window === "undefined" || !window.matchMedia("(min-width: 768px)").matches) return;
    // Only auto-start once there's a real class context. A student with
    // school_id but zero enrollments lands on the join-a-class view,
    // where the homework / graded / turn-in targets don't exist — so the
    // spotlight would chase nothing. Gate on at least one class.
    if (!classes || classes.length === 0) return;
    // Defer to first paint so the spotlight targets are mounted; the
    // welcome cover shows first, giving the dashboard fetch time to land
    // before the user steps into the spotlights.
    const raf = requestAnimationFrame(() => {
      autoStartedRef.current = true;
      tour.start("student");
    });
    return () => cancelAnimationFrame(raf);
  }, [user, tour, classes]);

  if (error) {
    return <PageErrorState message={error} onRetry={load} />;
  }

  if (data === null || classes === null) {
    return <DashboardSkeleton />;
  }

  // First-run student with no enrolled classes. Showing the normal
  // "all caught up / no graded work" cards here is misleading and
  // dead-ends them, so render a welcome + join-class CTA instead.
  if (classes.length === 0 && !classesError) {
    return (
      <>
        <div className="mx-auto max-w-3xl">
          <div className="dashboard-card-enter">
            <Greeting firstName={data.first_name} />
          </div>
          <div
            className="dashboard-card-enter rounded-[--radius-xl] border border-border bg-surface px-6 py-14 text-center"
            style={{ animationDelay: "80ms" }}
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
              Welcome
            </p>
            <h2 className="mt-3 font-serif text-2xl text-text-primary">
              Let&rsquo;s get you into a class
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-secondary">
              You&rsquo;re not enrolled in any classes yet. Ask your teacher for
              their class code, then join to see your homework, practice, and
              grades here.
            </p>
            <div className="mt-6 flex justify-center">
              <Button variant="primary" onClick={() => setShowJoin(true)}>
                Join your first class
              </Button>
            </div>
          </div>
        </div>
        <SidebarJoinModal
          open={showJoin}
          onClose={() => setShowJoin(false)}
          onJoined={() => {
            loadClasses();
            load();
          }}
        />
      </>
    );
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
        <div
          data-tour-id={TOUR_IDS.studentHomework}
          className="dashboard-card-enter"
          style={{ animationDelay: "80ms" }}
        >
          <DashboardCard
            title="Due this week"
            count={dueCount}
            bodyTourId={TOUR_IDS.studentTurnIn}
          >
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

        <div
          data-tour-id={TOUR_IDS.studentGetUnstuck}
          className="dashboard-card-enter"
          style={{ animationDelay: "160ms" }}
        >
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
            {recently_graded.length > 0 && (
              <Link
                href="/school/student/grades"
                className="flex items-center justify-center gap-1 border-t border-border-light/60 px-5 py-3 text-xs font-semibold text-primary transition-colors hover:bg-surface-hover"
              >
                See all grades
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
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
      <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
        Today
      </span>
      <h1 className="mt-2 font-serif text-[40px] leading-[1.05] tracking-[-0.02em] text-text-primary">
        {greeting}
        {firstName ? `, ${firstName}` : ""}
      </h1>
      <p className="mt-2 font-serif italic text-[16px] leading-snug text-text-secondary">
        {today}
      </p>
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
