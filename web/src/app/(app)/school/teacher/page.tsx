"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { teacher, type TeacherCourse } from "@/lib/api";
import { formatDueRelative } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { WatchHow, useWalkthrough } from "@/components/walkthrough";
import { StatusPill } from "@/components/school/teacher/_pieces/status-pill";
import { SubjectChip } from "@/components/school/teacher/_pieces/subject-chip";
import { NeedsYouQueue } from "@/components/school/teacher/_pieces/needs-you-queue";
import { Modal, Select } from "@/components/ui";
import { Skeleton } from "@/components/ui/skeleton";

export default function SchoolTeacherDashboard() {
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewCourse, setShowNewCourse] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await teacher.courses();
      setCourses(res.courses);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load courses");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  // ── First-login walkthrough ──
  // A teacher who has never seen the video walkthrough gets it once, on
  // their first visit to My Courses (desktop and mobile alike — it's just
  // a video). Seen-state reuses the `tours_seen` "teacher" key, so
  // teachers who already took the old spotlight tour aren't shown it.
  // Marked seen on open, not close: a refresh mid-video must not loop it.
  const walkthrough = useWalkthrough();
  const user = useAuthStore((s) => s.user);
  const markTourSeen = useAuthStore((s) => s.markTourSeen);
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!user || user.role !== "teacher" || user.is_preview) return;
    if (user.tours_seen.includes("teacher")) return;
    autoOpenedRef.current = true;
    walkthrough.open("welcome");
    void markTourSeen("teacher");
  }, [user, walkthrough, markTourSeen]);

  // Roll-ups across every course — the "what needs me right now" line
  // teachers want to see before they pick which course to open.
  const totals = useMemo(
    () =>
      courses.reduce(
        (acc, c) => ({
          toReview: acc.toReview + c.to_review,
          flagged: acc.flagged + c.flagged,
        }),
        { toReview: 0, flagged: 0 },
      ),
    [courses],
  );

  return (
    <div className="mx-auto max-w-4xl">
      {/* Editorial page header — eyebrow → serif h1 → italic-serif sub.
          Same rhythm as the dashboard's page-header pattern. */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
              Teacher
            </span>
            <h1 className="mt-2 font-serif text-[40px] leading-[1.05] tracking-[-0.02em] text-text-primary">
              My Courses
            </h1>
            <p className="mt-2 font-serif italic text-[16px] leading-snug text-text-secondary">
              {loading
                ? "Loading…"
                : courses.length === 0
                  ? "Nothing here yet."
                  : describeWorkload(courses.length, totals)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {/* The only walkthrough entry on phones, where the sidebar
                (and its "Video walkthrough" item) is hidden. */}
            <WatchHow chapter="welcome" className="md:hidden" />
            <button
              type="button"
              className="shrink-0 rounded-[--radius-sm] bg-primary px-4 py-2 text-sm font-semibold tracking-[0.01em] text-white transition-colors hover:bg-primary-dark"
              onClick={() => setShowNewCourse(true)}
            >
              New Course
            </button>
          </div>
        </div>
      </motion.div>

      {error && (
        <div className="mt-4 rounded-[--radius-sm] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] p-3 text-sm text-[color:var(--color-error)]">
          {error}
        </div>
      )}

      {/* Initial-load placeholder — a "Needs you today" queue + courses
          list silhouette so a returning teacher sees the page settle in
          place instead of a lone header floating over white space. */}
      {loading && !error && <DashboardSkeleton />}

      {!loading && courses.length === 0 && !error && (
        <div className="mt-10 border-t border-b border-border-light px-0 py-20 text-center">
          <p className="font-serif italic text-[20px] text-text-muted">
            No courses yet.
          </p>
          <button
            onClick={() => setShowNewCourse(true)}
            className="mt-4 text-sm font-semibold tracking-[0.01em] text-primary hover:underline"
          >
            Create your first course →
          </button>
          <p className="mt-6 text-sm text-text-secondary">
            New to Veradic? See the whole job, from setup to published grades.
          </p>
          <WatchHow chapter="welcome" className="mt-1" />
        </div>
      )}

      {/* The single actionable list — every submission waiting on the
          teacher across all courses, most-urgent-first. Sits above the
          courses list so the Monday-morning answer to "what needs me?"
          is the first thing here, not a per-course hunt. Only shown once
          the teacher actually has courses; a brand-new teacher gets the
          onboarding empty state above instead. */}
      {courses.length > 0 && <NeedsYouQueue />}

      {courses.length > 0 && (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.2 }}
        className="mt-10"
      >
        <h2 className="font-serif text-[24px] leading-tight tracking-[-0.01em] text-text-primary">
          Your courses
        </h2>
        <div className="mt-3 border-t border-border-light">
          {courses.map((course) => (
            <CourseRow key={course.id} course={course} />
          ))}
        </div>
      </motion.div>
      )}

      {showNewCourse && (
        <NewCourseModal
          onClose={() => setShowNewCourse(false)}
          onCreated={() => {
            setShowNewCourse(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * Initial-load placeholder for the dashboard body. Mirrors the real
 * silhouette — a "Needs you today" queue card over a hairline courses
 * list — so a returning teacher sees the page settle in place instead
 * of a lone header over white space while courses load.
 */
function DashboardSkeleton() {
  return (
    <div className="mt-8" aria-busy="true" aria-live="polite">
      <Skeleton className="h-7 w-44" />
      <div className="mt-3 overflow-hidden rounded-[--radius-md] border border-border bg-surface">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 px-4 py-3.5 ${
              i === 0 ? "" : "border-t border-border-light"
            }`}
          >
            <Skeleton className="h-5 w-[74px] rounded-[2px]" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>

      <div className="mt-10">
        <Skeleton className="h-7 w-36" />
        <div className="mt-3 border-t border-border-light">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 border-b border-border-light px-1 py-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-6 w-2/5" />
              </div>
              <Skeleton className="h-6 w-28 rounded-[2px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function describeWorkload(
  courseCount: number,
  totals: { toReview: number; flagged: number },
): string {
  const courseLabel = `${courseCount} course${courseCount === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (totals.toReview > 0) {
    parts.push(`${totals.toReview} to review`);
  }
  if (totals.flagged > 0) {
    parts.push(`${totals.flagged} flagged`);
  }
  if (parts.length === 0) return `${courseLabel} · all caught up`;
  return `${courseLabel} · ${parts.join(" · ")}`;
}

function CourseRow({ course }: { course: TeacherCourse }) {
  const dueLabel = course.next_due_at ? formatDueRelative(course.next_due_at) : null;
  const hasWork = course.to_review > 0 || course.flagged > 0;

  // Hairline list row — same grammar as dashboard's .list-row pattern:
  // serif primary line, sans secondary, paper-2 hover, no shadow lift.
  return (
    <Link
      href={`/school/teacher/courses/${course.id}`}
      className="group flex flex-col gap-3 border-b border-border-light px-1 py-5 transition-colors hover:bg-[color:var(--color-surface-alt-2)] sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 text-[11px] text-text-muted">
          <SubjectChip subject={course.subject} />
          {course.grade_level && (
            <>
              <span className="font-medium uppercase tracking-[0.08em]">Grade {course.grade_level}</span>
              <span aria-hidden className="text-[color:var(--color-border)]">·</span>
            </>
          )}
          <span className="font-medium uppercase tracking-[0.08em] text-text-secondary">
            {course.section_count} section{course.section_count === 1 ? "" : "s"}
          </span>
        </div>
        <h2 className="mt-1.5 truncate font-serif text-[22px] leading-tight tracking-[-0.01em] text-text-primary transition-colors group-hover:text-primary">
          {course.name}
        </h2>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {course.to_review > 0 && (
          <StatusPill
            tone="amber"
            label={`${course.to_review} to review`}
          />
        )}
        {course.flagged > 0 && (
          <StatusPill
            tone="red"
            label={`${course.flagged} flagged`}
            icon="⚑"
          />
        )}
        {!hasWork && (
          <StatusPill tone="green" label="All caught up" icon="✓" />
        )}
        {dueLabel && (
          <span className="font-mono text-[12px] text-text-muted">{dueLabel}</span>
        )}
      </div>
    </Link>
  );
}

function NewCourseModal({ onClose, onCreated }: { onClose: () => void; onCreated: (courseId: string) => void }) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("math");
  const [gradeLevel, setGradeLevel] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (gradeLevel) {
      const g = Number(gradeLevel);
      if (!Number.isInteger(g) || g < 1 || g > 12) {
        setError("Grade level must be between 1 and 12");
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await teacher.createCourse({
        name: name.trim(),
        subject,
        grade_level: gradeLevel ? Number(gradeLevel) : undefined,
      });
      onCreated(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create course");
      setSubmitting(false);
    }
  };

  return (
    // Shared Modal carries Escape-to-close, focus-trap, aria-modal, and
    // initial-focus — the bespoke backdrop+form this replaced had none.
    // Dismiss is suppressed mid-submit so a backdrop/Escape can't orphan
    // an in-flight create.
    <Modal open onClose={onClose} dismissible={!submitting}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 className="font-serif text-[24px] leading-tight tracking-[-0.01em] text-text-primary">New course</h2>

        <div className="mt-5 space-y-4">
          <Field label="Course name *">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="e.g. Algebra 1"
              className="w-full rounded-[--radius-sm] border border-border bg-surface px-3 py-2 text-[15px] text-text-primary transition-colors focus:border-primary"
              autoFocus
            />
          </Field>

          <Field label="Subject">
            <Select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full"
            >
              <option value="math">Math</option>
              <option value="physics">Physics</option>
              <option value="chemistry">Chemistry</option>
            </Select>
          </Field>

          <Field label="Grade level (optional)">
            <input
              type="number"
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value)}
              placeholder="9"
              min={1}
              max={12}
              className="w-full rounded-[--radius-sm] border border-border bg-surface px-3 py-2 text-[15px] text-text-primary transition-colors focus:border-primary"
            />
          </Field>

        </div>

        {error && <p className="mt-3 text-xs text-[color:var(--color-error)]">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-[--radius-sm] border border-border bg-transparent px-4 py-2 text-sm font-semibold tracking-[0.01em] text-text-secondary transition-colors hover:border-text-primary hover:text-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-[--radius-sm] bg-primary px-4 py-2 text-sm font-semibold tracking-[0.01em] text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create course"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
