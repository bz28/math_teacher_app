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
      {!loading && (
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
      )}

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
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-text-primary">Your Courses</h2>
            {courses.length > 5 && (
              <Link href="/teacher/courses" className="text-sm font-semibold text-primary hover:text-primary-dark">
                View all ({courses.length})
              </Link>
            )}
          </div>
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
          className="mt-8 rounded-[--radius-xl] border border-border-light bg-surface p-8"
        >
          <h2 className="text-lg font-bold text-text-primary">
            Welcome! Let&rsquo;s get you set up.
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Follow these steps to start using Veradic AI with your students.
          </p>
          <div className="mt-6 space-y-4">
            <OnboardingStep
              number="1"
              title="Create your first course"
              description="Give it a name and pick a subject — like 'Algebra I' or 'AP Chemistry'."
              action={<Link href="/teacher/courses" className="text-sm font-semibold text-primary hover:text-primary-dark">Create Course &rarr;</Link>}
              completed={false}
            />
            <OnboardingStep
              number="2"
              title="Add a class section"
              description="Sections represent your class periods — Period 1, Block A, etc."
              completed={false}
              dimmed
            />
            <OnboardingStep
              number="3"
              title="Share the join code with students"
              description="Students enter a 6-character code and they're in. No emails, no paperwork."
              completed={false}
              dimmed
            />
          </div>
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

function OnboardingStep({
  number,
  title,
  description,
  action,
  completed,
  dimmed,
}: {
  number: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  completed: boolean;
  dimmed?: boolean;
}) {
  return (
    <div className={`flex gap-4 ${dimmed ? "opacity-40" : ""}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        completed
          ? "bg-green-100 text-green-600 dark:bg-green-500/10"
          : "bg-primary-bg text-primary"
      }`}>
        {completed ? (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : number}
      </div>
      <div className="flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-muted">{description}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
