"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import { teacher, type TeacherCourse } from "@/lib/api";

export default function TeacherDashboard() {
  const { user } = useAuthStore();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    teacher.courses().then((d) => setCourses(d.courses)).finally(() => setLoading(false));
  }, []);

  const totalSections = courses.reduce((sum, c) => sum + c.section_count, 0);
  const totalDocs = courses.reduce((sum, c) => sum + c.doc_count, 0);
  const firstName = user?.name?.split(" ")[0] || "Teacher";

  return (
    <div className="mx-auto max-w-4xl">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-extrabold tracking-tight text-text-primary">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 text-text-secondary">
          {user?.school_name || "Your teacher dashboard"}
        </p>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mt-8 grid grid-cols-3 gap-4"
      >
        <StatCard label="Courses" value={courses.length} />
        <StatCard label="Sections" value={totalSections} />
        <StatCard label="Documents" value={totalDocs} />
      </motion.div>

      {/* Quick actions */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mt-8"
      >
        <h2 className="text-lg font-bold text-text-primary">Quick Actions</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Link
            href="/teacher/courses"
            className="flex items-center gap-3 rounded-[--radius-lg] border border-border-light bg-surface p-4 transition-colors hover:border-primary/30 hover:bg-primary-bg/30"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-[--radius-md] bg-primary-bg text-primary">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
              </svg>
            </div>
            <div>
              <div className="font-semibold text-text-primary">Manage Courses</div>
              <div className="text-xs text-text-muted">Create courses, manage sections</div>
            </div>
          </Link>
          <Link
            href="/home"
            className="flex items-center gap-3 rounded-[--radius-lg] border border-border-light bg-surface p-4 transition-colors hover:border-primary/30 hover:bg-primary-bg/30"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-[--radius-md] bg-green-50 text-green-600 dark:bg-green-500/10">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 3l4 4-4 4" />
                <path d="M20 7H4" />
                <path d="M8 21l-4-4 4-4" />
                <path d="M4 17h16" />
              </svg>
            </div>
            <div>
              <div className="font-semibold text-text-primary">Try as Student</div>
              <div className="text-xs text-text-muted">Experience what students see</div>
            </div>
          </Link>
        </div>
      </motion.div>

      {/* Recent courses */}
      {!loading && courses.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-8"
        >
          <h2 className="text-lg font-bold text-text-primary">Your Courses</h2>
          <div className="mt-3 space-y-2">
            {courses.slice(0, 5).map((course) => (
              <Link
                key={course.id}
                href={`/teacher/courses/${course.id}`}
                className="flex items-center justify-between rounded-[--radius-lg] border border-border-light bg-surface p-4 transition-colors hover:border-primary/30"
              >
                <div>
                  <div className="font-semibold text-text-primary">{course.name}</div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    {course.section_count} section{course.section_count !== 1 ? "s" : ""} · {course.doc_count} document{course.doc_count !== 1 ? "s" : ""}
                  </div>
                </div>
                <span className={`rounded-[--radius-pill] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                  course.status === "published"
                    ? "bg-green-50 text-green-600 dark:bg-green-500/10"
                    : "bg-amber-50 text-amber-600 dark:bg-amber-500/10"
                }`}>
                  {course.status}
                </span>
              </Link>
            ))}
          </div>
        </motion.div>
      )}

      {!loading && courses.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-8 rounded-[--radius-xl] border border-dashed border-border bg-surface p-12 text-center"
        >
          <p className="text-lg font-semibold text-text-primary">No courses yet</p>
          <p className="mt-1 text-sm text-text-muted">
            Create your first course to get started.
          </p>
          <Link
            href="/teacher/courses"
            className="mt-4 inline-flex items-center gap-2 rounded-[--radius-pill] bg-gradient-to-r from-primary to-primary-light px-6 py-2.5 text-sm font-bold text-white shadow-md transition-shadow hover:shadow-lg"
          >
            Create Course
          </Link>
        </motion.div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[--radius-lg] border border-border-light bg-surface p-4 text-center">
      <div className="text-2xl font-extrabold text-text-primary">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-text-muted">{label}</div>
    </div>
  );
}
