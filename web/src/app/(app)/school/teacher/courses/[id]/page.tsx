"use client";

import { Suspense, use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { teacher, type BankJob, type TeacherCourse } from "@/lib/api";
import {
  BANK_JOB_POLL_INTERVAL_MS,
  BANK_JOB_POLL_LIMIT_MS,
  BANK_JOB_TOAST_AUTO_CLEAR_MS,
} from "@/lib/constants";
import { SectionsTab } from "@/components/school/teacher/sections-tab";
import { MaterialsTab } from "@/components/school/teacher/materials-tab";
import { HomeworkTab } from "@/components/school/teacher/homework-tab";
import { SettingsTab } from "@/components/school/teacher/settings-tab";

type TabKey =
  | "sections"
  | "materials"
  | "homework"
  | "tests"
  | "submissions"
  | "grades"
  | "settings";

// Tabs in the visible nav row. Settings is intentionally excluded —
// it's reachable via the gear icon in the header.
const TABS: { key: TabKey; label: string }[] = [
  { key: "sections", label: "Sections" },
  { key: "materials", label: "Materials" },
  { key: "homework", label: "HW" },
  { key: "tests", label: "Tests" },
  { key: "submissions", label: "Submissions" },
  { key: "grades", label: "Grades" },
];

// All valid tab keys (including settings, which renders but doesn't
// appear in the tab row).
const ALL_TAB_KEYS: TabKey[] = [...TABS.map((t) => t.key), "settings"];

const DEFAULT_TAB: TabKey = "sections";

const ACTIVE_JOB_STORAGE_KEY = (courseId: string) => `bank.activeJob.${courseId}`;

export default function CourseWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  // Suspense boundary required because the inner component reads
  // useSearchParams, which opts the page into dynamic rendering and
  // needs a fallback while the client hydrates the query string.
  return (
    <Suspense>
      <CourseWorkspaceContent params={params} />
    </Suspense>
  );
}

function CourseWorkspaceContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [course, setCourse] = useState<TeacherCourse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab state lives in the URL (?tab=materials) so refresh, back/
  // forward, and deep-linked URLs all land on the right tab. Unknown
  // values fall back to the default.
  const tabParam = searchParams.get("tab");
  const tab: TabKey = ALL_TAB_KEYS.includes(tabParam as TabKey)
    ? (tabParam as TabKey)
    : DEFAULT_TAB;
  const setTab = useCallback(
    (next: TabKey) => {
      const qs = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_TAB) qs.delete("tab");
      else qs.set("tab", next);
      const q = qs.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );
  // Generation job lifted from the HW-scoped flow so it survives when
  // the teacher switches tabs, and so any in-flight generation shows a
  // dot indicator on the HW tab label from any view. Persisted to
  // sessionStorage so browser reload also recovers the in-flight job —
  // the backend keeps generating regardless of the client.
  const [activeJob, setActiveJob] = useState<BankJob | null>(null);

  // Single setter that keeps React state and sessionStorage in lockstep.
  // We DON'T use a separate "mirror to storage" effect because that
  // effect would fire on initial mount with activeJob=null and wipe
  // any persisted key BEFORE the restore effect could read it.
  const updateActiveJob = useCallback(
    (next: BankJob | null) => {
      setActiveJob(next);
      if (next) {
        sessionStorage.setItem(ACTIVE_JOB_STORAGE_KEY(id), next.id);
      } else {
        sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY(id));
      }
    },
    [id],
  );

  // On mount: restore + verify any persisted job from a previous tab
  // visit or browser reload.
  useEffect(() => {
    const stored = sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY(id));
    if (!stored) return;
    let cancelled = false;
    teacher
      .bankJob(id, stored)
      .then((job) => {
        if (cancelled) return;
        // Verify the fetched job actually matches the stored id —
        // defends against future backend rotation/replay where the
        // server might return a different shape than expected.
        if (job.id !== stored) {
          sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY(id));
          return;
        }
        // Only restore if the job is still actionable — done bulk jobs
        // would just flash the toast pointlessly, failed ones are noise.
        if (
          job.status === "queued" ||
          job.status === "running" ||
          (job.status === "done" && job.parent_question_id)
        ) {
          setActiveJob(job);
        } else {
          sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY(id));
        }
      })
      .catch(() => {
        sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY(id));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Poll the active job from the page level so it survives tab switches.
  useEffect(() => {
    if (!activeJob || activeJob.status === "done" || activeJob.status === "failed") return;
    const startedAt = Date.now();
    const jobId = activeJob.id;
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > BANK_JOB_POLL_LIMIT_MS) {
        updateActiveJob({
          ...activeJob,
          status: "failed",
          error_message: "Generation timed out — try again or refresh the page.",
        });
        return;
      }
      try {
        const updated = await teacher.bankJob(id, jobId);
        updateActiveJob(updated);
      } catch {
        // keep polling, transient errors are fine
      }
    }, BANK_JOB_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [activeJob, id, updateActiveJob]);

  // Auto-clear bulk-generation toasts after a few seconds. Make-similar
  // jobs (parent_question_id set) stay until the teacher clicks Review.
  useEffect(() => {
    if (activeJob?.status === "done" && !activeJob.parent_question_id) {
      const t = setTimeout(() => updateActiveJob(null), BANK_JOB_TOAST_AUTO_CLEAR_MS);
      return () => clearTimeout(t);
    }
  }, [activeJob?.status, activeJob?.parent_question_id, updateActiveJob]);

  const jobInFlight =
    activeJob !== null &&
    activeJob.status !== "failed" &&
    !(activeJob.status === "done" && !activeJob.parent_question_id);

  const reloadCourse = async () => {
    // Never flip loading back to true — that would swap the page out
    // for the <Loading…> splash, unmounting the active tab and losing
    // its in-memory state (e.g. the folder MaterialsTab is viewing).
    // The initial load is handled by useState(true) + the first
    // successful fetch clearing it below.
    try {
      setCourse(await teacher.course(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load course");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadCourse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return <div className="mx-auto max-w-6xl text-sm text-text-muted">Loading…</div>;
  }
  if (error || !course) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="text-sm text-red-600">{error ?? "Course not found."}</p>
        <Link href="/school/teacher" className="mt-4 inline-block text-sm font-semibold text-primary">
          ← Back to courses
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Link
          href="/school/teacher"
          className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-primary"
        >
          ← My Courses
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-text-primary">{course.name}</h1>
            <p className="mt-1 text-sm text-text-secondary">
              {course.grade_level ? `Grade ${course.grade_level} · ` : ""}
              {course.section_count} section{course.section_count === 1 ? "" : "s"} ·{" "}
              {course.doc_count} document{course.doc_count === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTab("settings")}
            aria-label="Course settings"
            className={`shrink-0 rounded-full p-2 transition-colors ${
              tab === "settings"
                ? "bg-primary/10 text-primary"
                : "text-text-muted hover:bg-bg-subtle hover:text-text-primary"
            }`}
          >
            <GearIcon />
          </button>
        </div>
      </motion.div>

      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border-light">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`relative shrink-0 px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.key ? "text-primary" : "text-text-muted hover:text-text-primary"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              {t.label}
              {/* Pulsing dot when generation is in flight — visible
                  from any tab so the teacher knows problems are still
                  being generated for one of their HWs. */}
              {t.key === "homework" && jobInFlight && (
                <span className="relative flex h-2 w-2" aria-label="Generation in progress">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
              )}
            </span>
            {tab === t.key && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "sections" && <SectionsTab courseId={course.id} onChanged={reloadCourse} />}
        {tab === "materials" && <MaterialsTab courseId={course.id} onChanged={reloadCourse} />}
        {tab === "homework" && <HomeworkTab courseId={course.id} />}
        {tab === "tests" && <ComingSoon name="Tests" phase="Phase 5" />}
        {tab === "submissions" && <ComingSoon name="Submissions" phase="a future update" />}
        {tab === "grades" && <ComingSoon name="Grades" phase="a future update" />}
        {tab === "settings" && <SettingsTab course={course} onChanged={reloadCourse} />}
      </div>
    </div>
  );
}

function ComingSoon({ name, phase }: { name: string; phase: string }) {
  return (
    <div className="rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle p-12 text-center">
      <p className="text-sm font-bold text-text-primary">{name}</p>
      <p className="mt-1 text-xs text-text-muted">Coming in {phase}.</p>
    </div>
  );
}

function GearIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
