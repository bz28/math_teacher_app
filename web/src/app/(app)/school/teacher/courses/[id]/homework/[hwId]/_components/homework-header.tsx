"use client";

import { useState } from "react";
import { Breadcrumbs } from "@/components/school/teacher/breadcrumbs";
import { useCourseName } from "@/components/school/teacher/teacher-courses";
import { formatDue, sectionTargetLabel, sectionToneClass } from "@/lib/utils";
import type { TeacherSection } from "@/lib/api";
import type { HomeworkDetail } from "../_lib/types";

/**
 * The top of the homework page: the breadcrumb (course › homework; the
 * course crumb goes back to its Homework or Practice tab), the status chips and the
 * click-to-edit title, and the read-only scan line (due · sections ·
 * problem count). The title edit is local until Save; `onSaveTitle`
 * calls `done` once the edit should close.
 */
export function HomeworkHeader({
  courseId,
  hw,
  backHref,
  problemCount,
  courseSections,
  loading,
  busy,
  onSaveTitle,
}: {
  courseId: string;
  hw: HomeworkDetail | null;
  backHref: string;
  problemCount: number;
  courseSections: TeacherSection[] | null;
  loading: boolean;
  busy: boolean;
  onSaveTitle: (draft: string, done: () => void) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const isPublished = hw?.status === "published";
  const courseName = useCourseName(courseId);
  return (
    <>
        <Breadcrumbs
      className="pt-3"
      items={[
        { label: courseName ?? "", href: backHref },
        { label: hw?.title ?? "" },
      ]}
    />

    {/* Hero header row: status + title. Publish lives in the sticky
            action bar at the viewport bottom so it stays reachable even
            on long HWs with many problems below. */}
        <header className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0 flex-1">
            {hw && (
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    isPublished
                      ? "bg-green-600 text-white dark:bg-green-500"
                      : "border border-gray-300 text-gray-700 dark:border-gray-500/40 dark:text-gray-300"
                  }`}
                >
                  {hw.status}
                </span>
                {hw.type === "practice" && (
                  <span className="inline-block rounded-[--radius-pill] bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                    Practice
                  </span>
                )}
              </div>
            )}
            <div className="mt-2">
              {editingTitle ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onSaveTitle(titleDraft, () => setEditingTitle(false));
                  }}
                >
                  <input
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    autoFocus
                    maxLength={300}
                    className="flex-1 rounded-[--radius-md] border border-primary bg-surface px-3 py-2 text-xl font-extrabold text-text-primary focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTitle(false);
                      setTitleDraft(hw?.title ?? "");
                    }}
                    className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(hw?.title ?? "");
                    setEditingTitle(true);
                  }}
                  disabled={loading || isPublished}
                  title={isPublished ? "Unpublish to edit" : "Click to edit"}
                  className="cursor-text text-left text-3xl font-extrabold tracking-tight text-text-primary hover:text-primary disabled:cursor-default disabled:hover:text-text-primary"
                >
                  {hw?.title ?? "Loading…"}
                </button>
              )}
            </div>
          </div>

        </header>

        {/* Read-only metadata strip — surfaces due / sections / problem
            count without making the teacher expand the Configuration
            accordion below. Editing still happens there; this is the
            scan line. Practice has no due-date concept, so it's omitted
            for that type. */}
        {hw && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
            {hw.type !== "practice" && (
              <>
                <span className={hw.due_at ? "" : "italic"}>
                  {hw.due_at ? formatDue(hw.due_at) : "No due date"}
                </span>
                <span aria-hidden>·</span>
              </>
            )}
            {(() => {
              // Same helper and the same inputs as the Configuration
              // summary further down, so the two can't disagree on the
              // same page.
              const s = sectionTargetLabel({
                selectedNames: hw.section_names,
                status: hw.status,
                courseSectionCount: courseSections?.length ?? null,
              });
              return <span className={sectionToneClass(s.tone)}>{s.label}</span>;
            })()}
            <span aria-hidden>·</span>
            <span>
              {problemCount} {problemCount === 1 ? "problem" : "problems"}
            </span>
          </div>
        )}
    </>
  );
}
