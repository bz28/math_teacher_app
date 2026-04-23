"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { teacher, type SubmissionsInboxRow } from "@/lib/api";
import { formatDueShort } from "@/lib/utils";
import { EmptyState } from "@/components/school/shared/empty-state";
import { ProgressBar } from "./_pieces/progress-bar";

/**
 * Submissions tab — the teacher's grading inbox.
 *
 * One row per (published HW × section) pair. Rows with outstanding
 * work (flagged or to-grade) sort to the top by due date ascending;
 * fully-handled rows sink so finished HWs don't outrank ones that
 * still need attention.
 */
export function SubmissionsTab({ courseId }: { courseId: string }) {
  const [rows, setRows] = useState<SubmissionsInboxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    teacher
      .submissionsInbox(courseId)
      .then((res) => {
        if (!cancelled) setRows(res.rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load inbox");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const sections = useMemo(() => {
    if (!rows) return [];
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (!seen.has(r.section_id)) seen.set(r.section_id, r.section_name);
    }
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    let out = rows;
    if (sectionId !== "all") {
      out = out.filter((r) => r.section_id === sectionId);
    }
    if (q) {
      out = out.filter((r) => r.assignment_title.toLowerCase().includes(q));
    }
    return out.slice().sort(compareRows);
  }, [rows, sectionId, search]);

  if (error) {
    return <p className="mt-6 text-sm text-red-600">{error}</p>;
  }

  if (rows === null) {
    return <p className="mt-6 text-sm text-text-muted">Loading inbox…</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState text="Nothing submitted yet. Publish a homework and student work will land here for grading." />
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          >
            🔍
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search homework"
            className="w-full rounded-[--radius-md] border border-border-light bg-bg-base py-2 pl-9 pr-3 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </div>
        <select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          aria-label="Filter by section"
          className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-xs font-semibold text-text-secondary hover:border-primary/40 hover:text-primary focus:border-primary focus:outline-none"
        >
          <option value="all">All sections</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-xs text-text-muted">
          No homework matches those filters.
        </p>
      ) : (
        <div className="mt-5 space-y-2">
          {filtered.map((r) => (
            <InboxRow key={`${r.assignment_id}-${r.section_id}`} row={r} courseId={courseId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────

function InboxRow({
  row,
  courseId,
}: {
  row: SubmissionsInboxRow;
  courseId: string;
}) {
  const href = `/school/teacher/courses/${courseId}/homework/${row.assignment_id}/sections/${row.section_id}/review`;
  const dueLabel = row.due_at ? formatDueShort(row.due_at) : "No due date";
  const overdueDays = row.due_at ? daysOverdue(row.due_at) : 0;
  const hasOutstanding = row.to_grade + row.dirty + row.flagged > 0;
  // "to review" folds fresh-ungraded + dirty-republish into one count.
  // From the teacher's point of view both states mean "needs a click
  // before students see it"; the mechanical split doesn't help scan.
  const toReview = row.to_grade + row.dirty;

  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-[--radius-md] border border-border-light bg-surface px-4 py-3 transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-bold text-text-primary">
            {row.assignment_title}
          </h3>
          <span className="text-[11px] text-text-muted">·</span>
          <span className="shrink-0 text-xs text-text-secondary">{row.section_name}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
          <span>{dueLabel}</span>
          {overdueDays > 0 && hasOutstanding && (
            <>
              <span>·</span>
              <span className="font-semibold text-red-600 dark:text-red-400">
                {overdueDays === 1 ? "1 day overdue" : `${overdueDays} days overdue`}
              </span>
            </>
          )}
          {row.flagged > 0 && (
            <>
              <span>·</span>
              <span className="font-semibold text-red-600 dark:text-red-400">
                ⚑ {row.flagged} flagged
              </span>
            </>
          )}
        </div>
        {row.submitted === 0 ? (
          // No submissions yet — three empty bars would be visual noise.
          // One honest line beats three zeroed bars.
          <p className="mt-2 text-[11px] italic text-text-muted">
            No work to review yet
          </p>
        ) : (
          <div className="mt-2 space-y-1">
            <ProgressBar
              label="Submitted"
              current={row.submitted}
              total={row.total_students}
              color="blue"
            />
            <ProgressBar
              label="To review"
              current={toReview}
              total={row.submitted}
              color="amber"
            />
            <ProgressBar
              label="Published"
              current={row.published}
              total={row.submitted}
              color="green"
            />
          </div>
        )}
      </div>
      <span className="shrink-0 rounded-[--radius-md] bg-primary px-4 py-2 text-xs font-bold text-white group-hover:bg-primary-dark">
        Review →
      </span>
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sort + format helpers
// ────────────────────────────────────────────────────────────────────

/** Rows with outstanding work (flagged or ungraded) come first, each
 *  group ordered by due date ascending. Null due dates sink within
 *  their group. */
function compareRows(a: SubmissionsInboxRow, b: SubmissionsInboxRow): number {
  const aWork = a.flagged + a.to_grade + a.dirty > 0 ? 0 : 1;
  const bWork = b.flagged + b.to_grade + b.dirty > 0 ? 0 : 1;
  if (aWork !== bWork) return aWork - bWork;
  return dueKey(a) - dueKey(b);
}

function dueKey(r: SubmissionsInboxRow): number {
  return r.due_at ? new Date(r.due_at).getTime() : Number.MAX_SAFE_INTEGER;
}

function daysOverdue(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  const days = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
  return days > 0 ? days : 0;
}

