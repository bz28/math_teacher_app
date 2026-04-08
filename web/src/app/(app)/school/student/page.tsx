"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { schoolStudent, type StudentClassSummary } from "@/lib/api";

export default function SchoolStudentDashboard() {
  const [classes, setClasses] = useState<StudentClassSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    schoolStudent
      .listClasses()
      .then(setClasses)
      .catch(() => setError("Couldn't load your classes. Please try again."));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <p className="text-error">{error}</p>
      </div>
    );
  }

  if (classes === null) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center text-text-muted">
        Loading…
      </div>
    );
  }

  if (classes.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <h1 className="text-2xl font-bold text-text-primary">No classes yet</h1>
        <p className="mt-2 text-text-secondary">
          Ask your teacher for a join code to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-text-primary">Your classes</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Pick a class to see your homework.
      </p>
      <div className="mt-6 grid gap-3">
        {classes.map((c) => (
          <Link
            key={`${c.section_id}`}
            href={`/school/student/courses/${c.course_id}`}
            className="group flex items-center justify-between rounded-[--radius-md] border border-border bg-surface p-5 transition-colors hover:border-primary"
          >
            <div>
              <div className="text-base font-semibold text-text-primary group-hover:text-primary">
                {c.course_name}
              </div>
              <div className="mt-1 text-sm text-text-secondary">{c.section_name}</div>
            </div>
            <svg
              className="h-5 w-5 text-text-muted group-hover:text-primary"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
  );
}
