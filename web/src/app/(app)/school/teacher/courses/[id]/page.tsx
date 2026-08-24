"use client";

import { Suspense, use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { teacher, type BankJob, type TeacherCourse } from "@/lib/api";
import {
  BANK_JOB_POLL_INTERVAL_MS,
  BANK_JOB_POLL_LIMIT_MS,
  BANK_JOB_TOAST_AUTO_CLEAR_MS,
} from "@/lib/constants";
import { formatDueRelative } from "@/lib/utils";
import { TOUR_ACTIONS, TOUR_IDS, useTour, useTourAction } from "@/components/tour";
import { StatusPill } from "@/components/school/teacher/_pieces/status-pill";
import { SectionsTab } from "@/components/school/teacher/sections-tab";
import { MaterialsTab } from "@/components/school/teacher/materials-tab";
import { HomeworkTab } from "@/components/school/teacher/homework-tab";
import { PracticeTab } from "@/components/school/teacher/practice-tab";
import { SubmissionsTab } from "@/components/school/teacher/submissions-tab";
import { GradesTab } from "@/components/school/teacher/grades-tab";
import { SettingsTab } from "@/components/school/teacher/settings-tab";
import { EmptyState } from "@/components/school/shared/empty-state";
import { ErrorBoundary } from "@/components/ui";
import { Skeleton } from "@/components/ui/skeleton";

type TabKey =
  | "sections"
  | "materials"
  | "homework"
  | "practice"
  | "insights"
  | "submissions"
  | "grades"
  | "settings";

// Tabs in the visible nav row. Settings is intentionally excluded —
// it's reachable via the gear icon in the header.
const TABS: { key: TabKey; label: string; comingSoon?: boolean }[] = [
  { key: "sections", label: "Sections" },
  { key: "materials", label: "Materials" },
  { key: "homework", label: "Homework" },
  { key: "practice", label: "Practice" },
  // Gated while the surface is rebuilt on graded + understanding-check
  // signal. Still reachable — it lands on StudentInsightsComingSoon,
  // which explains why it's dark and where the signal lives meanwhile.
  { key: "insights", label: "Student Insights", comingSoon: true },
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

  // ── Onboarding tour wiring ──
  // The Field Guide tour (components/tour) replaces the old setup
  // checklist. This page registers the imperative handoffs each step
  // needs (tab switches + the live New-section dialog) and owns the
  // section modal so the tour can open it. It does NOT auto-start: the
  // from-zero tour begins on the courses list (a brand-new teacher has
  // no course) and carries across the navigation into this workspace,
  // resuming at "Create a section". Auto-starting here too would
  // double-fire during that continuation, so the courses list is the
  // sole owner of the first-run start.
  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const tour = useTour();
  // During the first-run tour, creating a section must advance the tour the
  // same way creating a course does (the course step's onCreated → next()).
  // SectionsTab routes both create and cancel through the modal-open boolean,
  // so this ref lets the close handler tell "just created" from "cancelled".
  const sectionCreatedRef = useRef(false);
  // One-shot request from step two: expand the first section's roster so
  // the invite control mounts. SectionsTab consumes it once a section is
  // present and clears it via onExpandFirstRosterConsumed.
  const [expandFirstRoster, setExpandFirstRoster] = useState(false);

  useTourAction(TOUR_ACTIONS.gotoSections, () => {
    setTab("sections");
    setSectionModalOpen(false);
  });
  useTourAction(TOUR_ACTIONS.openNewSection, () => {
    setTab("sections");
    setSectionModalOpen(true);
  });
  useTourAction(TOUR_ACTIONS.closeNewSection, () => setSectionModalOpen(false));
  useTourAction(TOUR_ACTIONS.expandFirstSection, () => {
    setTab("sections");
    setExpandFirstRoster(true);
  });
  useTourAction(TOUR_ACTIONS.gotoMaterials, () => setTab("materials"));
  useTourAction(TOUR_ACTIONS.gotoHomework, () => setTab("homework"));
  useTourAction(TOUR_ACTIONS.gotoPractice, () => setTab("practice"));
  useTourAction(TOUR_ACTIONS.gotoSubmissions, () => setTab("submissions"));
  useTourAction(TOUR_ACTIONS.gotoGrades, () => setTab("grades"));

  if (loading) {
    return <CourseWorkspaceSkeleton />;
  }
  if (error || !course) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="text-sm text-[color:var(--color-error)]">{error ?? "Course not found."}</p>
        <Link
          href="/school/teacher"
          className="mt-4 inline-block font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary transition-colors hover:text-text-primary"
        >
          ← Back to courses
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        <Link
          href="/school/teacher"
          className="inline-flex items-center gap-1 font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary transition-colors hover:text-text-primary"
        >
          ← My Courses
        </Link>
        <div className="mt-3 flex items-baseline justify-between gap-4">
          <h1 className="font-serif text-[40px] leading-[1.05] tracking-[-0.02em] text-text-primary">
            {course.name}
          </h1>
          <button
            type="button"
            onClick={() => setTab("settings")}
            aria-label="Course settings"
            className={`shrink-0 rounded-[--radius-sm] border p-2 transition-colors ${
              tab === "settings"
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-transparent text-text-muted hover:border-border hover:text-text-primary"
            }`}
          >
            <GearIcon />
          </button>
        </div>
        {/* Course-scoped status pills — same shape as the courses-list
            so the eye learns the row once. Lets the teacher answer
            "what's pressing in this course right now" without
            clicking into the Submissions tab. */}
        <CourseStatusRow course={course} />
      </motion.div>

      {/* Editorial tab bar — underline-on-active matches the student
          top-bar and app-shell grammar. No tinted pill backgrounds. */}
      <div className="mt-8 flex gap-6 overflow-x-auto border-b border-border-light">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            // Submissions and Grades anchor the onboarding tour on their
            // tab buttons — both tabs render an empty state (no stable
            // header/control) for a from-zero teacher, so the always-
            // mounted tab button is the only reliable spotlight target.
            data-tour-id={
              t.key === "submissions"
                ? TOUR_IDS.teacherSubmissions
                : t.key === "grades"
                  ? TOUR_IDS.teacherGrades
                  : undefined
            }
            onClick={() => setTab(t.key)}
            className={`relative shrink-0 py-3 text-sm font-medium transition-colors ${
              tab === t.key
                ? "font-semibold text-text-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              {t.label}
              {/* Pulsing dot when generation is in flight — visible
                  from any tab so the teacher knows problems are still
                  being generated. Shows on HW and Practice tabs; the
                  lifted activeJob doesn't know which it belongs to,
                  so we surface it on both to avoid false-negatives. */}
              {(t.key === "homework" || t.key === "practice") && jobInFlight && (
                <span className="relative flex h-2 w-2" aria-label="Generation in progress">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
              )}
              {/* Quiet "Soon" stamp on a gated tab. Muted, not primary —
                  it marks a hold, and must not compete with the primary-
                  tinted generation dot above for the same glance. */}
              {t.comingSoon && (
                <span className="rounded-[--radius-pill] border border-border-light px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
                  Soon
                </span>
              )}
            </span>
            {tab === t.key && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] bg-[color:var(--color-primary)]"
              />
            )}
          </button>
        ))}
      </div>

      {/* Per-tab error boundary — a render throw in one tab (bad payload,
          unexpected null) shows the branded retry surface for that tab
          instead of unmounting the whole workspace. Keyed by tab so
          switching tabs remounts the boundary and clears any latched
          error, letting the teacher move on to a healthy tab. */}
      <div className="mt-6">
        <ErrorBoundary key={tab}>
        {tab === "sections" && (
          <SectionsTab
            courseId={course.id}
            onChanged={reloadCourse}
            showNewSection={sectionModalOpen}
            onShowNewSectionChange={(open) => {
              if (!open) {
                if (sectionCreatedRef.current) {
                  // Create path: the tour already advanced via onSectionCreated;
                  // just close, don't treat this close as a cancel.
                  sectionCreatedRef.current = false;
                  setSectionModalOpen(false);
                  return;
                }
                if (tour.handoffActive) {
                  // Cancel during the tour gate: return to the section
                  // spotlight (re-prompt), mirroring the course step.
                  tour.back();
                  return;
                }
              }
              setSectionModalOpen(open);
            }}
            onSectionCreated={() => {
              sectionCreatedRef.current = true;
              // Advance only when the tour is parked on THIS step's handoff
              // (the open New-section dialog) — not merely tour-active. Guard
              // on handoffActive so creating a second section later (e.g. on
              // the invite step, where the New-section button is also visible)
              // doesn't spuriously skip the tour ahead.
              if (tour.handoffActive) tour.next();
            }}
            expandFirstRoster={expandFirstRoster}
            onExpandFirstRosterConsumed={() => setExpandFirstRoster(false)}
          />
        )}
        {tab === "materials" && <MaterialsTab courseId={course.id} onChanged={reloadCourse} />}
        {tab === "homework" && (
          <HomeworkTab
            courseId={course.id}
            onGoToMaterials={() => setTab("materials")}
          />
        )}
        {tab === "practice" && <PracticeTab courseId={course.id} />}
        {/* Gated: the tab read practice activity alone, which measures
            effort rather than understanding — a struggling student who
            never opens practice showed as "No activity". Dark until it
            reads graded work + the understanding checks too. */}
        {tab === "insights" && (
          <EmptyState
            title="Coming soon"
            description="We're rebuilding Student Insights."
          />
        )}
        {tab === "submissions" && <SubmissionsTab courseId={course.id} />}
        {tab === "grades" && <GradesTab courseId={course.id} />}
        {tab === "settings" && <SettingsTab course={course} onChanged={reloadCourse} />}
        </ErrorBoundary>
      </div>
    </div>
  );
}

/**
 * Initial-load placeholder for the course workspace. Mirrors the real
 * silhouette — eyebrow back-link, the 40px serif title, the status pill
 * row, the underlined tab bar, then a content slab — so the first paint
 * settles into the workspace instead of blanking to "Loading…".
 */
function CourseWorkspaceSkeleton() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy="true" aria-live="polite">
      <Skeleton className="h-3 w-24 rounded-[--radius-sm]" />
      <div className="mt-3 flex items-baseline justify-between gap-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-9 rounded-[--radius-sm]" />
      </div>
      {/* Status pill row */}
      <div className="mt-4 flex flex-wrap gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-28 rounded-[--radius-pill]" />
        ))}
      </div>
      {/* Tab bar */}
      <div className="mt-8 flex gap-6 border-b border-border-light pb-3">
        {["w-16", "w-20", "w-[72px]", "w-[68px]", "w-[88px]", "w-[76px]"].map(
          (w, i) => (
            <Skeleton key={i} className={`h-4 rounded-[--radius-sm] ${w}`} />
          ),
        )}
      </div>
      {/* Content slab */}
      <div className="mt-6 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-[--radius-lg]" />
        ))}
      </div>
    </div>
  );
}

function CourseStatusRow({ course }: { course: TeacherCourse }) {
  const dueLabel = course.next_due_at ? formatDueRelative(course.next_due_at) : null;
  const hasWork = course.to_review > 0 || course.flagged > 0;
  // Suppress the row only when there's truly nothing to say — no work
  // and no upcoming due date. With either signal present, render a
  // pill row so the dashboard's gating and this page's gating agree;
  // a course that's all-caught-up but has work coming up Thursday
  // should look the same on both screens.
  if (!hasWork && !dueLabel) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {course.to_review > 0 && (
        <StatusPill tone="amber" label={`${course.to_review} to review`} />
      )}
      {course.flagged > 0 && (
        <StatusPill tone="red" label={`${course.flagged} flagged`} icon="⚑" />
      )}
      {!hasWork && (
        <StatusPill tone="green" label="All caught up" icon="✓" />
      )}
      {dueLabel && (
        <span className="font-mono text-[12px] text-text-secondary">{dueLabel}</span>
      )}
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
