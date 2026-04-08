"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { schoolStudent, type StudentHomeworkSummary } from "@/lib/api";

export default function ClassDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const [homework, setHomework] = useState<StudentHomeworkSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    schoolStudent
      .listHomework(courseId)
      .then(setHomework)
      .catch(() => setError("Couldn't load your homework. Please try again."));
  }, [courseId]);

  if (error) {
    return <div className="mx-auto max-w-2xl py-12 text-center text-error">{error}</div>;
  }

  if (homework === null) {
    return <div className="mx-auto max-w-2xl py-12 text-center text-text-muted">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/school/student"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary"
      >
        ← Back to classes
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Homework</h1>

      {homework.length === 0 ? (
        <p className="mt-6 text-text-secondary">
          No homework has been assigned yet. Check back soon.
        </p>
      ) : (
        <div className="mt-6 grid gap-3">
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
                    {hw.problem_count} {hw.problem_count === 1 ? "problem" : "problems"}
                    {hw.due_at ? ` · Due ${new Date(hw.due_at).toLocaleDateString()}` : ""}
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
      )}
    </div>
  );
}
