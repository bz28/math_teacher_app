"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { teacher, type TeacherCourse } from "@/lib/api";
import { formatDueRelative } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { TOUR_ACTIONS, TOUR_IDS, useTour, useTourAction } from "@/components/tour";
import { StatusPill } from "@/components/school/teacher/_pieces/status-pill";
import { Select } from "@/components/ui";

// Subject chip color hooks. Flat tinted tag (no pill), 2px radius,
// uppercase tracked label — matches the dashboard badge family.
const subjectStyles: Record<string, { bg: string; text: string; label: string }> = {
  math: { bg: "bg-[color:var(--color-primary-bg)]", text: "text-[color:var(--color-primary-dark)]", label: "Math" },
  physics: { bg: "bg-[color:#E8F4FD] dark:bg-[#0D1F2B]", text: "text-[color:#0773C5] dark:text-[#A3D1FF]", label: "Physics" },
  chemistry: { bg: "bg-[color:#E0F1EC] dark:bg-[#0E241D]", text: "text-[color:#006E55] dark:text-[#5FC4A6]", label: "Chemistry" },
};

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

  // ── Onboarding tour wiring ──
  // A brand-new teacher lands here with no courses, so the courses list
  // is where the Field Guide tour begins. This page owns the first-run
  // auto-start and the live New-course handoff (step one); the tour's
  // provider lives in the app layout, so its state survives the
  // navigation into the freshly-created course, where it resumes at the
  // "Create a section" step (the course workspace no longer auto-starts).
  const router = useRouter();
  const tour = useTour();
  const user = useAuthStore((s) => s.user);

  useTourAction(TOUR_ACTIONS.openNewCourse, () => setShowNewCourse(true));
  useTourAction(TOUR_ACTIONS.closeNewCourse, () => setShowNewCourse(false));

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    // Don't restart a tour that's already running. A remount while the
    // tour is live — e.g. step one navigates into the new course, then
    // the teacher hits browser Back to this page — must resume in place,
    // not reset to the welcome and wipe progress. tours_seen still lacks
    // "teacher" mid-tour, so this active-guard is what holds the line.
    if (tour.isActive) return;
    if (!user || user.role !== "teacher") return;
    if (user.tours_seen.includes("teacher")) return;
    // Mount after first paint so the New-course button (step one's
    // target) exists. Latch only when start() actually fires, so a
    // cancelled frame reschedules rather than dropping the tour.
    const raf = requestAnimationFrame(() => {
      autoStartedRef.current = true;
      tour.start("teacher");
    });
    return () => cancelAnimationFrame(raf);
  }, [user, tour]);

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
          <button
            type="button"
            data-tour-id={TOUR_IDS.teacherNewCourse}
            className="shrink-0 rounded-[--radius-sm] bg-primary px-4 py-2 text-sm font-semibold tracking-[0.01em] text-white transition-colors hover:bg-primary-dark"
            onClick={() => setShowNewCourse(true)}
          >
            New Course
          </button>
        </div>
      </motion.div>

      {error && (
        <div className="mt-4 rounded-[--radius-sm] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] p-3 text-sm text-[color:var(--color-error)]">
          {error}
        </div>
      )}

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
        </div>
      )}

      {courses.length > 0 && (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.2 }}
        className="mt-8 border-t border-border-light"
      >
        {courses.map((course) => (
          <CourseRow key={course.id} course={course} />
        ))}
      </motion.div>
      )}

      {showNewCourse && (
        <NewCourseModal
          onClose={() => {
            // During the first-run gate the dialog is the only forward
            // path. Cancelling it returns to step one's spotlight (a
            // re-prompt) — it must not advance, and must not leave a
            // dangling resume bar. tour.back() while handed off runs the
            // close action and drops back to the spotlight, same step.
            if (tour.handoffActive) tour.back();
            else setShowNewCourse(false);
          }}
          onCreated={(courseId) => {
            setShowNewCourse(false);
            // During the first-run tour, creating a course advances past
            // step one and carries the (layout-level) tour into the new
            // course workspace, where it resumes at "Create a section".
            // Outside the tour, just refresh the list in place.
            if (tour.isActive) {
              tour.next();
              router.push(`/school/teacher/courses/${courseId}`);
            } else {
              reload();
            }
          }}
        />
      )}
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
  const sub = subjectStyles[course.subject] ?? subjectStyles.math;
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
          <span className={`rounded-[2px] px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-[0.08em] ${sub.bg} ${sub.text}`}>
            {sub.label}
          </span>
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
  const [description, setDescription] = useState("");
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
        description: description.trim() || undefined,
      });
      onCreated(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create course");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--color-overlay)] p-4" onClick={onClose}>
      <form
        className="w-full max-w-md rounded-[--radius-md] border border-border bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
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

          <Field label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={1000}
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
    </div>
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
