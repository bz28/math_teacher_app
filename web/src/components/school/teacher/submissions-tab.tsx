"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { teacher, type SubmissionsInboxRow } from "@/lib/api";
import { EmptyState } from "@/components/school/shared/empty-state";

/**
 * Submissions tab — the teacher's grading inbox.
 *
 * One row per (published HW × section) pair. Default sort is by
 * urgency so the loudest signals (integrity flags, graded-but-not-
 * published) surface first; teacher can flip to due date when they
 * want chronological scan.
 *
 * 8b will build the per-HW review page that Review → links to.
 */
type SortKey = "urgency" | "due";
type ScopeKey = "all" | "week" | "flagged";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function SubmissionsTab({ courseId }: { courseId: string }) {
  const [rows, setRows] = useState<SubmissionsInboxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("urgency");
  const [scope, setScope] = useState<ScopeKey>("all");
  const [search, setSearch] = useState("");
  // Freeze `now` at mount so the "Due this week" filter is stable
  // during render. Re-reading Date.now() inside useMemo is flagged
  // by react-hooks/purity; lazy-init side-steps that and any drift
  // across a long session is immaterial for a 7-day filter window.
  const [now] = useState(() => Date.now());

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

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    let out = rows;
    if (q) {
      out = out.filter(
        (r) =>
          r.assignment_title.toLowerCase().includes(q) ||
          r.section_name.toLowerCase().includes(q),
      );
    }
    if (scope === "flagged") {
      out = out.filter((r) => r.flagged > 0);
    } else if (scope === "week") {
      // "This week" = due within the next 7 days OR overdue by ≤7
      // days. Ancient overdue items are noise, not actionable.
      out = out.filter((r) => {
        if (r.due_at === null) return false;
        const delta = new Date(r.due_at).getTime() - now;
        return delta > -WEEK_MS && delta < WEEK_MS;
      });
    }
    const sorted = out.slice();
    sorted.sort((a, b) =>
      sort === "urgency" ? urgencyScore(b) - urgencyScore(a) : dueKey(a) - dueKey(b),
    );
    return sorted;
  }, [rows, scope, search, sort, now]);

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
      {/* Filter + sort row */}
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
            placeholder="Search by homework or section"
            className="w-full rounded-[--radius-md] border border-border-light bg-bg-base py-2 pl-9 pr-3 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </div>
        <ScopeChips scope={scope} onChange={setScope} />
        <SortToggle sort={sort} onChange={setSort} />
      </div>

      {/* Filtered-empty vs rendered list */}
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

function ScopeChips({
  scope,
  onChange,
}: {
  scope: ScopeKey;
  onChange: (next: ScopeKey) => void;
}) {
  const items: { key: ScopeKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "week", label: "Due this week" },
    { key: "flagged", label: "Flagged only" },
  ];
  return (
    <div className="flex items-center gap-1 rounded-[--radius-pill] bg-bg-subtle p-0.5">
      {items.map((it) => {
        const active = scope === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            className={`rounded-[--radius-pill] px-3 py-1 text-xs font-semibold transition-colors ${
              active
                ? "bg-surface text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function SortToggle({
  sort,
  onChange,
}: {
  sort: SortKey;
  onChange: (next: SortKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(sort === "urgency" ? "due" : "urgency")}
      title="Toggle sort"
      className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-xs font-semibold text-text-secondary hover:border-primary/40 hover:text-primary"
    >
      {sort === "urgency" ? "Sort: Urgency ↓" : "Sort: Due date ↓"}
    </button>
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
  const dueLabel = row.due_at ? formatDue(row.due_at) : "No due date";
  const overdueDays = row.due_at ? daysOverdue(row.due_at) : 0;
  const hasWork = row.submitted > 0 || row.flagged > 0 || row.to_grade > 0;

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
          {overdueDays > 0 && hasWork && row.to_grade + row.flagged > 0 && (
            <>
              <span>·</span>
              <span className="font-semibold text-red-600 dark:text-red-400">
                {overdueDays === 1 ? "1 day overdue" : `${overdueDays} days overdue`}
              </span>
            </>
          )}
          <span>·</span>
          <span>
            <span className="font-semibold text-text-primary">
              {row.submitted}
            </span>{" "}
            / {row.total_students} submitted
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {row.flagged > 0 && (
            <Pill tone="red" label={`${row.flagged} flagged`} />
          )}
          {row.to_grade > 0 && (
            <Pill tone="amber" label={`${row.to_grade} to grade`} />
          )}
          {row.published > 0 && (
            <Pill tone="green" label={`${row.published} published`} />
          )}
          {!hasWork && row.published === 0 && (
            <Pill tone="muted" label="No submissions yet" />
          )}
        </div>
      </div>
      <span className="shrink-0 rounded-[--radius-md] bg-primary px-4 py-2 text-xs font-bold text-white group-hover:bg-primary-dark">
        Review →
      </span>
    </Link>
  );
}

function Pill({
  tone,
  label,
}: {
  tone: "red" | "amber" | "green" | "muted";
  label: string;
}) {
  const cls = {
    red: "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
    amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    green: "border-green-200 bg-green-50 text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300",
    muted: "border-border-light bg-bg-subtle text-text-muted",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-[--radius-pill] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sort + format helpers
// ────────────────────────────────────────────────────────────────────

/** Higher = more urgent. Flagged submissions dominate, then graded-
 *  not-published, then any ungraded-submissions-waiting. */
function urgencyScore(r: SubmissionsInboxRow): number {
  return r.flagged * 1_000_000 + r.to_grade * 1_000 + (r.submitted - r.published);
}

/** For due-date sort: null due = Infinity so it sinks to the end. */
function dueKey(r: SubmissionsInboxRow): number {
  return r.due_at ? new Date(r.due_at).getTime() : Number.MAX_SAFE_INTEGER;
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No due date";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return `Due ${d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  })}`;
}

function daysOverdue(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  const days = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
  return days > 0 ? days : 0;
}
