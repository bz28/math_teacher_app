"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { teacher, type NeedsAttentionItem } from "@/lib/api";
import { Skeleton } from "@/components/ui";
import { FlagPills } from "./flag-pills";
import { StatusPill } from "./status-pill";
import { SubjectChip } from "./subject-chip";
import {
  groupNeedsYou,
  groupReviewHref,
  studentChip,
  studentCount,
  studentReviewHref,
  type NeedsYouGroup,
  type StudentChip,
} from "./needs-you-groups";

// How many homework × section rows show before the "Show N more"
// disclosure. A triage queue should surface the most urgent work
// without becoming a wall — the server sorts most-urgent-first, so the
// head is the part that matters most on a Monday morning.
const INITIAL_VISIBLE = 5;

// Reason → chip. Nothing here is alarm red: an understanding check worth
// a look raises scrutiny (amber, like other work waiting on the teacher)
// and never brands the student; a photo or reading problem is about the
// picture, not the student (muted). Info = a published grade edited since.
const CHIP: Record<
  StudentChip,
  { tone: "amber" | "info" | "muted"; label: string; icon?: string }
> = {
  worth_a_look: { tone: "amber", label: "Worth a look" },
  photo_problem: { tone: "muted", label: "Photo or reading" },
  too_long: { tone: "muted", label: "Too long for AI" },
  to_approve: { tone: "amber", label: "To approve" },
  to_publish: { tone: "info", label: "To publish" },
  republish: { tone: "info", label: "Republish", icon: "↻" },
  cant_ai_grade: { tone: "muted", label: "Can’t AI-grade" },
  overdue: { tone: "amber", label: "Overdue", icon: "‼" },
  ungraded: { tone: "muted", label: "Not graded" },
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

/** Cross-course "Needs you today" triage queue. The single actionable
 *  list a teacher sees before deciding which course to open — one row
 *  per homework × section with work waiting on them, counted the way the
 *  review page counts, most-urgent-first. Review lands on that section's
 *  review page at its most urgent student; the students behind a row
 *  open underneath it. */
export function NeedsYouQueue() {
  const [items, setItems] = useState<NeedsAttentionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();
  const groups = useMemo(() => (items ? groupNeedsYou(items) : null), [items]);
  const students = useMemo(() => (items ? studentCount(items) : 0), [items]);

  // Monotonic request id: only the newest attempt is allowed to write
  // state. Guards both the mount fetch and every Retry with one
  // mechanism — a stale resolve after unmount, or an older attempt a
  // rapid Retry superseded, is ignored rather than clobbering the
  // current queue.
  const reqId = useRef(0);

  // Load (and reload on Retry) the triage queue. Resets to the skeleton
  // state on each attempt so a retry reads as "trying again", not a
  // frozen error. The resets live inside the nested async fn (not the
  // effect/callback body) so the initial clear isn't a
  // synchronous-setState-in-effect.
  const load = useCallback(() => {
    const id = ++reqId.current;
    const run = async () => {
      setError(null);
      setItems(null);
      try {
        const res = await teacher.needsAttention();
        if (reqId.current === id) setItems(res.items);
      } catch (e) {
        if (reqId.current === id) setError(e instanceof Error ? e.message : "Failed to load");
      }
    };
    run();
  }, []);

  useEffect(() => {
    const ref = reqId; // capture the ref object for the cleanup closure
    load();
    // Invalidate any in-flight fetch on unmount so a late resolve no-ops.
    return () => {
      ref.current += 1;
    };
  }, [load]);

  // A failed fetch renders a calm inline notice with Retry inside the
  // section card (below) rather than vanishing the whole queue — a silent
  // return null is indistinguishable from a genuine "all caught up" on
  // this hero surface. The courses list below is still the durable
  // fallback; this just tells the teacher the read failed and lets them
  // retry in place.

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
        {groups !== null && groups.length > 0 && (
          <span className="font-mono text-[12px] tabular-nums text-text-muted">
            {groups.length} to review · {students} student
            {students === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="mt-3 overflow-hidden rounded-[--radius-md] border border-border bg-surface">
        {error ? (
          <QueueError onRetry={load} />
        ) : groups === null ? (
          <QueueSkeleton />
        ) : groups.length === 0 ? (
          <CaughtUp />
        ) : (
          <QueueList groups={groups} expanded={expanded} onExpand={() => setExpanded(true)} reduceMotion={!!reduceMotion} />
        )}
      </div>
    </motion.section>
  );
}

function QueueList({
  groups,
  expanded,
  onExpand,
  reduceMotion,
}: {
  groups: NeedsYouGroup[];
  expanded: boolean;
  onExpand: () => void;
  reduceMotion: boolean;
}) {
  const visible = expanded ? groups : groups.slice(0, INITIAL_VISIBLE);
  const hidden = groups.length - visible.length;

  return (
    <ul>
      <AnimatePresence initial={false}>
        {visible.map((group, i) => (
          <motion.li
            key={group.key}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18, delay: reduceMotion ? 0 : Math.min(i, 6) * 0.02 }}
          >
            <GroupRow group={group} first={i === 0} />
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

/** The counts a row carries, in the review page's words. Flags lead
 *  (FlagPills: never in alarm red), then the grades
 *  waiting on her (to approve, then approved and only to publish); what she'll grade from the photo and work the AI
 *  hasn't reached yet follow as quiet text — true, but not a call to act. */
function GroupCounts({ group }: { group: NeedsYouGroup }) {
  const quiet = [
    group.cantAiGrade > 0 && `${group.cantAiGrade} can’t be AI-graded`,
    group.ungraded > 0 && `${group.ungraded} not graded yet`,
  ].filter(Boolean);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <FlagPills
        worthALook={group.worthALook}
        photoProblems={group.photoProblem}
        tooLong={group.tooLong}
      />
      {group.toApprove > 0 && (
        <StatusPill tone="amber" label={`${group.toApprove} to approve`} />
      )}
      {group.toPublish > 0 && (
        <StatusPill tone="info" label={`${group.toPublish} to publish`} />
      )}
      {quiet.length > 0 && (
        <span className="text-[12px] text-text-muted">{quiet.join(" · ")}</span>
      )}
    </div>
  );
}

function GroupRow({ group, first }: { group: NeedsYouGroup; first: boolean }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const due = dueHint(group.due_at);
  const n = group.items.length;

  return (
    <div className={first ? "" : "border-t border-border-light"}>
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[18px] leading-tight tracking-[-0.01em] text-text-primary">
            <span className="break-words">{group.assignment_title}</span>
            <span aria-hidden className="mx-1.5 text-[color:var(--color-border)]">·</span>
            <span className="whitespace-nowrap">{group.section_name}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-text-secondary">
            <SubjectChip subject={group.subject} />
            <span>{group.course_name}</span>
            {due && (
              <>
                <span aria-hidden className="text-[color:var(--color-border)]">·</span>
                <span
                  className={
                    due.overdue ? "text-[color:var(--color-error)]" : "text-text-secondary"
                  }
                >
                  {due.text}
                </span>
              </>
            )}
            <span aria-hidden className="text-[color:var(--color-border)]">·</span>
            {/* The students behind the row — the old one-row-per-student
                detail, a click away instead of being the whole list. */}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={listId}
              className="inline-flex items-center gap-1 rounded-[2px] font-medium text-text-secondary underline decoration-[color:var(--color-border)] underline-offset-2 transition-colors hover:text-primary hover:decoration-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {n} student{n === 1 ? "" : "s"}
              <span
                aria-hidden
                className={`inline-block text-[10px] transition-transform ${open ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </button>
          </p>
          <GroupCounts group={group} />
        </div>

        <Link
          href={groupReviewHref(group)}
          aria-label={`Review ${group.assignment_title}, ${group.section_name}`}
          className={`inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-[--radius-sm] px-3.5 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:self-auto ${
            first
              ? "bg-primary text-white hover:bg-primary-dark"
              : "border border-border bg-surface text-text-primary hover:border-primary/40 hover:text-primary"
          }`}
        >
          Review
          <span aria-hidden>→</span>
        </Link>
      </div>

      {open && (
        <ul id={listId} className="border-t border-border-light bg-[color:var(--color-surface-alt-2)]/50 py-1">
          {group.items.map((item) => (
            <li key={item.submission_id}>
              <StudentRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StudentRow({ item }: { item: NeedsAttentionItem }) {
  const chip = CHIP[studentChip(item)];
  return (
    <Link
      href={studentReviewHref(item)}
      className="group flex items-center gap-3 py-1.5 pl-8 pr-4 transition-colors hover:bg-[color:var(--color-surface-alt-2)]"
    >
      <div className="flex min-w-[94px] shrink-0">
        <StatusPill tone={chip.tone} label={chip.label} icon={chip.icon} />
      </div>
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-text-primary transition-colors group-hover:text-primary">
        {item.student_name}
      </span>
      <span
        aria-hidden
        className="shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
      >
        →
      </span>
    </Link>
  );
}

/** Calm inline failure for the triage queue — one quiet line plus a small
 *  Retry, sized to sit inside the section card. Deliberately understated:
 *  a failed supplementary read shouldn't shout, but it shouldn't vanish
 *  the whole queue either (which reads as a false "all caught up"). */
function QueueError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-4">
      <p className="text-[13px] text-text-secondary">
        Couldn&rsquo;t load your queue.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-[12px] font-semibold text-text-secondary transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Retry
      </button>
    </div>
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
