"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { teacher, type TeacherCourse } from "@/lib/api";

const subjectStyles: Record<string, { bg: string; text: string; label: string }> = {
  math: { bg: "bg-primary-bg", text: "text-primary", label: "Math" },
  physics: { bg: "bg-blue-50 dark:bg-blue-500/10", text: "text-blue-600", label: "Physics" },
  chemistry: { bg: "bg-green-50 dark:bg-green-500/10", text: "text-green-600", label: "Chemistry" },
};

const statusStyles: Record<string, string> = {
  active: "bg-green-50 text-green-600 dark:bg-green-500/10",
  published: "bg-green-50 text-green-600 dark:bg-green-500/10",
  draft: "bg-amber-50 text-amber-600 dark:bg-amber-500/10",
  archived: "bg-gray-100 text-gray-500 dark:bg-gray-500/10",
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

  return (
    <div className="mx-auto max-w-5xl">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-text-primary">My Courses</h1>
            <p className="mt-1 text-text-secondary">
              {loading ? "Loading…" : `${courses.length} course${courses.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <button
            type="button"
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
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
        className="mt-6 grid gap-4 sm:grid-cols-2"
      >
        {courses.map((course) => {
          const sub = subjectStyles[course.subject] ?? subjectStyles.math;
          return (
            <Link
              key={course.id}
              href={`/school/teacher/courses/${course.id}`}
              className="group block rounded-[--radius-xl] border border-border-light bg-surface p-5 transition-all hover:border-primary/30 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${sub.bg} ${sub.text}`}>
                      {sub.label}
                    </span>
                    {course.grade_level && (
                      <span className="text-xs text-text-muted">Grade {course.grade_level}</span>
                    )}
                  </div>
                  <h2 className="mt-2 truncate text-lg font-bold text-text-primary group-hover:text-primary">
                    {course.name}
                  </h2>
                  {course.description && (
                    <p className="mt-1 line-clamp-1 text-xs text-text-muted">{course.description}</p>
                  )}
                </div>
                <span className={`shrink-0 rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusStyles[course.status] ?? statusStyles.draft}`}>
                  {course.status}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                <Stat label="Sections" value={course.section_count} />
                <Stat label="Documents" value={course.doc_count} />
              </div>
            </Link>
          );
        })}
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-base font-extrabold text-text-primary">{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-text-muted">{label}</div>
    </div>
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
