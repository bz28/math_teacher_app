"use client";

import type { TeacherAssignment } from "@/lib/api";

// One homework as a card. Surfaces all the at-a-glance state a
// teacher needs to triage their homeworks without clicking in:
//
//   📝 hw 1: Linear equations                  [DRAFT]   Open ↗
//   Due Fri Apr 11 · Period 2, Period 3
//   5 problems · ⚠️ 1 needs variations
//
// Click anywhere on the card to open the detail modal.
export function HomeworkCard({
  hw,
  needsVariationsCount,
  onOpen,
}: {
  hw: TeacherAssignment;
  /** How many problems in this HW have zero practice variations.
   *  Computed by the parent (which already has bank items in scope).
   *  null = unknown / not yet loaded. */
  needsVariationsCount: number | null;
  onOpen: () => void;
}) {
  const isPublished = hw.status === "published";
  const dueLabel = hw.due_at ? formatDue(hw.due_at) : "No due date";
  const sectionLabel =
    hw.section_names.length > 0
      ? hw.section_names.join(", ")
      : "No sections";
  const problemCount = hw.problem_count;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-[--radius-lg] border border-border-light bg-surface p-4 text-left transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg" aria-hidden>
          📝
        </span>
        <div className="min-w-0 flex-1">
          {/* Title row: title + status pill */}
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-base font-bold text-text-primary">
              {hw.title}
            </h3>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                isPublished
                  ? "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300"
                  : "border border-text-muted/40 text-text-muted"
              }`}
            >
              {isPublished ? "published" : "draft"}
            </span>
          </div>

          {/* Meta row 1: due date · sections */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
            <span className={hw.due_at ? "" : "italic"}>{dueLabel}</span>
            <span aria-hidden>·</span>
            <span
              className={hw.section_names.length === 0 ? "italic" : ""}
              title={hw.section_names.join(", ")}
            >
              {sectionLabel}
            </span>
          </div>

          {/* Meta row 2: problem count + variation health */}
          <div className="mt-0.5 text-[11px] text-text-muted">
            {problemCount} {problemCount === 1 ? "problem" : "problems"}
            {needsVariationsCount !== null && needsVariationsCount > 0 && (
              <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">
                · ⚠️ {needsVariationsCount} need variation
                {needsVariationsCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        <span className="shrink-0 self-center rounded-[--radius-md] border border-border-light px-2 py-1 text-[10px] font-bold text-text-secondary">
          Open ↗
        </span>
      </div>
    </button>
  );
}

// "Fri Apr 11" / "Mon Apr 14, 11:59 PM" — concise, locale-aware,
// drops the year unless it's not the current year.
function formatDue(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  // Only show the time if it's not midnight (the default for date-only).
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (!hasTime) return `Due ${date}`;
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Due ${date}, ${time}`;
}
