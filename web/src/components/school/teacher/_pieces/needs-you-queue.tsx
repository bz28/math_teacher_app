"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { teacher, type NeedsAttentionItem, type NeedsAttentionReason } from "@/lib/api";
import { Skeleton } from "@/components/ui";
import { StatusPill } from "./status-pill";
import { SubjectChip } from "./subject-chip";

// How many rows show before the "Show N more" disclosure. A triage
// queue should surface the most urgent work without becoming a wall —
// the server already sorts most-urgent-first, so the head is the part
// that matters most on a Monday morning.
const INITIAL_VISIBLE = 5;

// Reason → chip. Mirrors the dashboard's StatusPill vocabulary so the
// queue reads the same as the per-course pills: red = integrity, amber
// = grading work, info = a published grade the teacher edited since.
const REASON_CHIP: Record<
  NeedsAttentionReason,
  { tone: "red" | "amber" | "info"; label: string; icon?: string }
> = {
  flagged: { tone: "red", label: "Flagged", icon: "⚑" },
  overdue: { tone: "amber", label: "Overdue", icon: "‼" },
  ungraded: { tone: "amber", label: "Ungraded" },
  dirty: { tone: "info", label: "Republish", icon: "↻" },
};

/** A due-date hint that's honest about overdue work. `formatDueRelative`
 *  collapses everything past-due to "Today"; here we surface how far
 *  overdue it actually is, in error ink, so the urgency is legible. */
function dueHint(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const ms = d.getTime() - now.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (ms < 0) {
    const days = Math.floor(-ms / day);
    if (days <= 0) return { text: "Due earlier today", overdue: true };
    if (days === 1) return { text: "1 day overdue", overdue: true };
    if (days < 14) return { text: `${days} days overdue`, overdue: true };
    return {
      text: `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      overdue: true,
    };
  }
  const days = Math.round(ms / day);
  if (days <= 0) return { text: "Due today", overdue: false };
  if (days === 1) return { text: "Due tomorrow", overdue: false };
  if (days < 7)
    return { text: `Due ${d.toLocaleDateString(undefined, { weekday: "short" })}`, overdue: false };
  return {
    text: `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    overdue: false,
  };
}

function reviewHref(item: NeedsAttentionItem): string {
  return (
    `/school/teacher/courses/${item.course_id}` +
    `/homework/${item.assignment_id}/sections/${item.section_id}/review` +
    `?student=${item.student_id}`
  );
}

/** Cross-course "Needs you today" triage queue. The single actionable
 *  list a teacher sees before deciding which course to open — every
 *  submission waiting on them, most-urgent-first, each row a one-click
 *  deep-link straight into the grading pane for that exact student. */
export function NeedsYouQueue() {
  const [items, setItems] = useState<NeedsAttentionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    teacher
      .needsAttention()
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A failed fetch stays silent — the courses list below is the durable
  // fallback, and a red error block above the page would be louder than
  // the problem warrants for a supplementary surface.
  if (error) return null;

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mt-8"
      aria-label="Needs you today"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-[24px] leading-tight tracking-[-0.01em] text-text-primary">
          Needs you today
        </h2>
        {items !== null && items.length > 0 && (
          <span className="font-mono text-[12px] tabular-nums text-text-muted">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="mt-3 overflow-hidden rounded-[--radius-md] border border-border bg-surface">
        {items === null ? (
          <QueueSkeleton />
        ) : items.length === 0 ? (
          <CaughtUp />
        ) : (
          <QueueList items={items} expanded={expanded} onExpand={() => setExpanded(true)} reduceMotion={!!reduceMotion} />
        )}
      </div>
    </motion.section>
  );
}

function QueueList({
  items,
  expanded,
  onExpand,
  reduceMotion,
}: {
  items: NeedsAttentionItem[];
  expanded: boolean;
  onExpand: () => void;
  reduceMotion: boolean;
}) {
  const visible = expanded ? items : items.slice(0, INITIAL_VISIBLE);
  const hidden = items.length - visible.length;

  return (
    <ul>
      <AnimatePresence initial={false}>
        {visible.map((item, i) => (
          <motion.li
            key={item.submission_id}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18, delay: reduceMotion ? 0 : Math.min(i, 6) * 0.02 }}
          >
            <QueueRow item={item} first={i === 0} />
          </motion.li>
        ))}
      </AnimatePresence>
      {hidden > 0 && (
        <li>
          <button
            type="button"
            onClick={onExpand}
            className="w-full border-t border-border-light px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-text-secondary transition-colors hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary"
          >
            Show {hidden} more
          </button>
        </li>
      )}
    </ul>
  );
}

function QueueRow({ item, first }: { item: NeedsAttentionItem; first: boolean }) {
  const chip = REASON_CHIP[item.reason];
  const due = dueHint(item.due_at);

  return (
    <Link
      href={reviewHref(item)}
      className={`group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[color:var(--color-surface-alt-2)] ${
        first ? "" : "border-t border-border-light"
      }`}
    >
      <div className="flex min-w-[94px] shrink-0">
        <StatusPill tone={chip.tone} label={chip.label} icon={chip.icon} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-serif text-[17px] leading-tight tracking-[-0.01em] text-text-primary transition-colors group-hover:text-primary">
          {item.student_name}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] text-text-secondary">
          <span className="font-medium text-text-primary">{item.assignment_title}</span>
          <span aria-hidden className="mx-1.5 text-[color:var(--color-border)]">·</span>
          {item.course_name}
          <span aria-hidden className="mx-1.5 text-[color:var(--color-border)]">·</span>
          {item.section_name}
        </p>
      </div>

      <div className="hidden shrink-0 sm:block">
        <SubjectChip subject={item.subject} />
      </div>

      <div className="w-[112px] shrink-0 text-right">
        {due && (
          <span
            className={`font-mono text-[12px] ${
              due.overdue ? "text-[color:var(--color-error)]" : "text-text-muted"
            }`}
          >
            {due.text}
          </span>
        )}
      </div>

      <span
        aria-hidden
        className="shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
      >
        →
      </span>
    </Link>
  );
}

function CaughtUp() {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-12 text-center">
      <span
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--color-primary-bg)] text-[15px] text-[color:var(--color-primary)]"
      >
        ✓
      </span>
      <p className="mt-1 font-serif text-[18px] italic text-text-primary">
        You&rsquo;re all caught up
      </p>
      <p className="text-[13px] text-text-muted">
        Nothing is waiting on you right now.
      </p>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className={`flex items-center gap-3 px-4 py-3.5 ${
            i === 0 ? "" : "border-t border-border-light"
          }`}
        >
          <Skeleton className="h-5 w-[74px] rounded-[2px]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
