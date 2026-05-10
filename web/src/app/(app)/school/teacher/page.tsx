"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { teacher, type TeacherCourse } from "@/lib/api";
import { formatDueRelative } from "@/lib/utils";
import { StatusPill } from "@/components/school/teacher/_pieces/status-pill";

const subjectStyles: Record<string, { bg: string; text: string; label: string }> = {
  math: { bg: "bg-primary-bg", text: "text-primary", label: "Math" },
  physics: { bg: "bg-blue-50 dark:bg-blue-500/10", text: "text-blue-600", label: "Physics" },
  chemistry: { bg: "bg-green-50 dark:bg-green-500/10", text: "text-green-600", label: "Chemistry" },
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
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-extrabold tracking-tight text-text-primary">My Courses</h1>
            <p className="mt-1 text-sm text-text-secondary">
              {loading
                ? "Loading…"
                : courses.length === 0
                  ? "No courses yet"
                  : describeWorkload(courses.length, totals)}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
            onClick={() => setShowNewCourse(true)}
          >
            + New Course
          </button>
        </div>
      </motion.div>

      {error && (
        <div className="mt-4 rounded-[--radius-md] border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10">
          {error}
        </div>
      )}

      {!loading && courses.length === 0 && !error && (
        <div className="mt-8 rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle p-10 text-center">
          <p className="text-sm text-text-muted">No courses yet.</p>
          <button
            onClick={() => setShowNewCourse(true)}
            className="mt-3 text-sm font-bold text-primary hover:underline"
          >
            Create your first course →
          </button>
        </div>
      )}

      {courses.length > 0 && (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mt-6 space-y-3"
      >
        {courses.map((course) => (
          <CourseRow key={course.id} course={course} />
        ))}
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

  return (
    <Link
      href={`/school/teacher/courses/${course.id}`}
      className="group flex flex-col gap-3 rounded-[--radius-xl] border border-border-light bg-surface p-5 transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span className={`rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${sub.bg} ${sub.text}`}>
            {sub.label}
          </span>
          {course.grade_level && (
            <>
              <span>Grade {course.grade_level}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="text-text-secondary">
            {course.section_count} section{course.section_count === 1 ? "" : "s"}
          </span>
        </div>
        <h2 className="mt-1.5 truncate text-lg font-bold text-text-primary group-hover:text-primary">
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
          <span className="text-xs font-medium text-text-muted">{dueLabel}</span>
        )}
      </div>
    </Link>
  );
}

function NewCourseModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
      await teacher.createCourse({
        name: name.trim(),
        subject,
        grade_level: gradeLevel ? Number(gradeLevel) : undefined,
        description: description.trim() || undefined,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create course");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="w-full max-w-md rounded-[--radius-xl] bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 className="text-lg font-bold text-text-primary">New Course</h2>

        <div className="mt-4 space-y-4">
          <Field label="Course name *">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="e.g. Algebra 1"
              className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
              autoFocus
            />
          </Field>

          <Field label="Subject">
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
            >
              <option value="math">Math</option>
              <option value="physics">Physics</option>
              <option value="chemistry">Chemistry</option>
            </select>
          </Field>

          <Field label="Grade level (optional)">
            <input
              type="number"
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value)}
              placeholder="9"
              min={1}
              max={12}
              className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
            />
          </Field>

          <Field label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={1000}
              className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
            />
          </Field>
        </div>

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-[--radius-md] border border-border-light px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create Course"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-text-muted">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
