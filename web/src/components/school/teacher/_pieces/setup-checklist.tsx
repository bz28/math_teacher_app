"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { teacher, type CourseSetupStatus } from "@/lib/api";

/** Tab targets the checklist can deep-link into. Kept as a string union
 *  rather than importing the page's TabKey so this piece stays decoupled
 *  from the workspace's full tab set. */
type SetupTab = "sections" | "materials" | "homework" | "submissions";

interface Step {
  key: keyof CourseSetupStatus;
  label: string;
  cta: string;
  tab: SetupTab;
}

// The required first-run sequence: section → students → materials →
// homework → grade. Order is load-bearing — it's the path a brand-new
// teacher should walk, top to bottom.
const STEPS: Step[] = [
  { key: "has_section", label: "Add a class section", cta: "Add a section", tab: "sections" },
  { key: "has_student", label: "Invite your students", cta: "Invite students", tab: "sections" },
  { key: "has_materials", label: "Add course materials", cta: "Add materials", tab: "materials" },
  { key: "has_homework", label: "Create your first homework", cta: "Create homework", tab: "homework" },
  { key: "has_published_grade", label: "Grade & publish", cta: "Go to submissions", tab: "submissions" },
];

const DISMISS_KEY = (courseId: string) => `veradic_setup_dismissed_${courseId}`;

/** Whether this course's checklist was previously dismissed. Safe in SSR
 *  / private-mode where localStorage may be unavailable. */
function readDismissed(courseId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISMISS_KEY(courseId)) === "1";
  } catch {
    return false;
  }
}

/**
 * First-run "Set up your class" checklist — a dismissible card at the top
 * of the course workspace. Shown only while at least one step is
 * incomplete AND the teacher hasn't dismissed it for this course. Once
 * every step is done it hides itself (no dismissal needed); a fresh
 * gap reopening (e.g. last student removed) won't resurface it if the
 * teacher already dismissed.
 *
 * `version` lets the parent nudge a refetch after it reloads the course
 * (e.g. a section was just added) without this component owning the
 * mutation events.
 */
export function SetupChecklist({
  courseId,
  onNavigate,
  version = 0,
}: {
  courseId: string;
  onNavigate: (tab: SetupTab) => void;
  version?: number;
}) {
  const [status, setStatus] = useState<CourseSetupStatus | null>(null);
  // Local "dismissed now" override layered on top of the persisted flag.
  // We track the course it belongs to so a course switch (without remount)
  // re-derives from storage instead of leaking the previous course's state.
  const [dismissOverride, setDismissOverride] = useState<{ courseId: string } | null>(null);

  // Persisted dismissal — read during render (not in an effect) so there's
  // no setState-in-effect cascade. Recomputed each render; cheap.
  const persistedDismissed = readDismissed(courseId);
  const dismissed =
    dismissOverride?.courseId === courseId ? true : persistedDismissed;

  // Fetch (and refetch on version bump) the milestone booleans. A failed
  // fetch leaves status null → the card stays hidden, never blocking the
  // workspace.
  useEffect(() => {
    let cancelled = false;
    teacher
      .courseSetupStatus(courseId)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        /* non-blocking — leave the card hidden on error */
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, version]);

  if (!status) return null;

  const doneCount = STEPS.filter((s) => status[s.key]).length;
  const allDone = doneCount === STEPS.length;

  // Auto-hide once complete (no dismissal needed), or if dismissed.
  if (allDone || dismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY(courseId), "1");
    } catch {
      /* storage may be unavailable (private mode) — still hide for the session */
    }
    setDismissOverride({ courseId });
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      aria-label="Set up your class checklist"
      className="mt-8 rounded-[--radius-lg] border border-border bg-surface p-6 sm:p-7"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            Get started
          </p>
          <h2 className="mt-2 font-serif text-[1.6rem] leading-tight text-text-primary">
            Set up your class
          </h2>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss setup checklist"
          className="-mr-1 -mt-1 shrink-0 rounded-[--radius-sm] p-1.5 text-text-muted transition-colors hover:text-text-primary"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <p className="mt-1 font-mono text-[12px] text-text-secondary">
        {doneCount} of {STEPS.length} done
      </p>

      <ol className="mt-5 divide-y divide-border-light border-t border-border-light">
        {STEPS.map((step) => {
          const done = status[step.key];
          return (
            <li
              key={step.key}
              className="flex items-center justify-between gap-4 py-3.5"
            >
              <div className="flex items-center gap-3">
                <CheckMark done={done} />
                <span
                  className={
                    done
                      ? "text-[15px] text-text-muted line-through decoration-text-muted/40"
                      : "text-[15px] text-text-primary"
                  }
                >
                  {step.label}
                </span>
              </div>
              {!done && (
                <button
                  type="button"
                  onClick={() => onNavigate(step.tab)}
                  className="group inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:text-primary-dark"
                >
                  {step.cta}
                  <span className="transition-transform group-hover:translate-x-0.5">→</span>
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </motion.section>
  );
}

/** Brand-green check when done; a hollow hairline ring when pending. */
function CheckMark({ done }: { done: boolean }) {
  if (done) {
    return (
      <span
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-primary"
        aria-hidden="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[18px] w-[18px]"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="h-[18px] w-[18px] shrink-0 rounded-full border border-border"
      aria-hidden="true"
    />
  );
}
