"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  schoolStudent,
  student,
  type StudentClassSummary,
} from "@/lib/api";

export default function SchoolStudentDashboard() {
  const [classes, setClasses] = useState<StudentClassSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  const loadClasses = () => {
    schoolStudent
      .listClasses()
      .then(setClasses)
      .catch(() => setError("Couldn't load your classes. Please try again."));
  };

  useEffect(() => {
    loadClasses();
  }, []);

  async function handleJoinSection(e: React.FormEvent) {
    e.preventDefault();
    if (joinCode.trim().length < 4 || joining) return;
    setJoining(true);
    setJoinError("");
    try {
      await student.joinSection(joinCode.trim());
      setJoinCode("");
      // Student stays on this page — just refresh the class list.
      // No loadUser / redirect needed: the student already has
      // school_id stamped (that's why they're on /school/student in
      // the first place), so the join endpoint's stamp-if-null
      // branch is a no-op here.
      loadClasses();
    } catch (err) {
      setJoinError((err as Error).message || "Invalid code");
    } finally {
      setJoining(false);
    }
  }

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
    // Empty state: the join form IS the primary call to action. A
    // student with zero enrollments has no other meaningful action
    // on this page.
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <h1 className="text-2xl font-bold text-text-primary">No classes yet</h1>
        <p className="mt-2 text-text-secondary">
          Enter a join code from your teacher to get started.
        </p>
        <form
          onSubmit={handleJoinSection}
          className="mt-6 flex items-center justify-center gap-2"
        >
          <input
            type="text"
            value={joinCode}
            onChange={(e) => {
              setJoinCode(e.target.value.toUpperCase());
              setJoinError("");
            }}
            placeholder="Enter class code"
            maxLength={6}
            className="w-44 rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm font-mono font-semibold tracking-widest text-text-primary outline-none placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-text-muted focus:border-primary"
          />
          <button
            type="submit"
            disabled={joinCode.trim().length < 4 || joining}
            className="rounded-[--radius-sm] bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            {joining ? "Joining…" : "Join"}
          </button>
        </form>
        {joinError && (
          <p className="mt-3 text-sm text-error">{joinError}</p>
        )}
      </div>
    );
  }

  // Populated state: class list is the hero; the join form lives in
  // the header so students who get a new join code from any teacher
  // can add another class without leaving the portal.
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Your classes</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Pick a class to see your homework.
          </p>
        </div>
        <div className="flex flex-col items-end">
          <form
            onSubmit={handleJoinSection}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value.toUpperCase());
                setJoinError("");
              }}
              placeholder="Join another class"
              maxLength={6}
              className="w-40 rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm font-mono font-semibold tracking-widest text-text-primary outline-none placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-text-muted focus:border-primary"
            />
            <button
              type="submit"
              disabled={joinCode.trim().length < 4 || joining}
              className="rounded-[--radius-sm] bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {joining ? "…" : "Join"}
            </button>
          </form>
          {joinError && (
            <p className="mt-1 text-xs text-error">{joinError}</p>
          )}
        </div>
      </div>
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
