"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { mockCourses, type MockCourse } from "@/lib/school/mock-data";

const subjectStyles: Record<MockCourse["subject"], { bg: string; text: string; label: string }> = {
  math: { bg: "bg-primary-bg", text: "text-primary", label: "Math" },
  physics: { bg: "bg-blue-50 dark:bg-blue-500/10", text: "text-blue-600", label: "Physics" },
  chemistry: { bg: "bg-green-50 dark:bg-green-500/10", text: "text-green-600", label: "Chemistry" },
};

const statusStyles: Record<MockCourse["status"], string> = {
  active: "bg-green-50 text-green-600 dark:bg-green-500/10",
  draft: "bg-amber-50 text-amber-600 dark:bg-amber-500/10",
  archived: "bg-gray-100 text-gray-500 dark:bg-gray-500/10",
};

export default function SchoolTeacherDashboard() {
  return (
    <div className="mx-auto max-w-5xl">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-text-primary">My Courses</h1>
            <p className="mt-1 text-text-secondary">
              {mockCourses.length} courses · {mockCourses.reduce((s, c) => s + c.student_count, 0)} students
            </p>
          </div>
          <button
            type="button"
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
            onClick={() => alert("(mock) New Course modal would open here")}
          >
            + New Course
          </button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mt-6 grid gap-4 sm:grid-cols-2"
      >
        {mockCourses.map((course) => {
          const sub = subjectStyles[course.subject];
          const needsAttention = course.pending_grading > 0 || course.bank_pending > 0;
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
                    <span className="text-xs text-text-muted">{course.grade_level}</span>
                  </div>
                  <h2 className="mt-2 truncate text-lg font-bold text-text-primary group-hover:text-primary">
                    {course.name}
                  </h2>
                  {course.description && (
                    <p className="mt-1 line-clamp-1 text-xs text-text-muted">{course.description}</p>
                  )}
                </div>
                <span className={`shrink-0 rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusStyles[course.status]}`}>
                  {course.status}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="Sections" value={course.section_count} />
                <Stat label="Students" value={course.student_count} />
                <Stat label="Bank" value={course.bank_approved} />
              </div>

              {needsAttention && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-border-light pt-3 text-xs">
                  {course.pending_grading > 0 && (
                    <span className="rounded-[--radius-pill] bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-500/10">
                      {course.pending_grading} to grade
                    </span>
                  )}
                  {course.bank_pending > 0 && (
                    <span className="rounded-[--radius-pill] bg-blue-50 px-2 py-0.5 font-semibold text-blue-700 dark:bg-blue-500/10">
                      {course.bank_pending} bank pending
                    </span>
                  )}
                </div>
              )}
            </Link>
          );
        })}
      </motion.div>

      <p className="mt-8 text-center text-xs text-text-muted">
        🚧 Phase 1 mock — no real data. Click any course to explore the new workspace.
      </p>
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
