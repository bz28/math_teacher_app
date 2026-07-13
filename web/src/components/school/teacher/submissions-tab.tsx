"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { teacher, type SubmissionsInboxRow } from "@/lib/api";
import { formatDueShort } from "@/lib/utils";
import { EmptyState } from "@/components/school/shared/empty-state";
import { Select } from "@/components/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { PageErrorState } from "@/components/ui/page-error-state";
import { SearchIcon } from "@/components/ui/icons";
import { ProgressBar } from "./_pieces/progress-bar";
import { StatusPill } from "./_pieces/status-pill";

/** Review-pane deep link for a (HW × section) inbox row. Shared by the
 *  row link, the "Grade next" jump, and the zero-submission preview so
 *  the route shape lives in exactly one place. */
function reviewHref(courseId: string, row: SubmissionsInboxRow): string {
  return `/school/teacher/courses/${courseId}/homework/${row.assignment_id}/sections/${row.section_id}/review`;
}

/**
 * Submissions tab — the teacher's grading inbox.
 *
 * One row per (published HW × section) pair. Rows with outstanding
 * work (flagged or to-grade) sort to the top by due date ascending;
 * fully-handled rows sink so finished HWs don't outrank ones that
 * still need attention.
 *
 * Two batch affordances sit above the list so a teacher doesn't have
 * to hunt rows for the most common moves:
 *   • "Grade next" jumps straight into the highest-priority review pane
 *     (flagged → ungraded-overdue → ungraded).
 *   • "Republish all" fans the existing per-HW publish-grades endpoint
 *     across every homework with edited-but-unreleased grades.
 */
export function SubmissionsTab({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<SubmissionsInboxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string>("all");
  const [search, setSearch] = useState("");
  // Bump to re-fire the inbox fetch (the retry affordance on the error
  // state). The retry handler clears rows/error so the skeleton shows
  // while the refetch is in flight.
  const [reloadKey, setReloadKey] = useState(0);
  const retry = () => {
    setRows(null);
    setError(null);
    setReloadKey((k) => k + 1);
  };

  const load = useCallback(async () => {
    const res = await teacher.submissionsInbox(courseId);
    return res.rows;
  }, [courseId]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load inbox");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load, reloadKey]);

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

  // "Grade next" target — the single highest-priority row in the
  // CURRENT view (respects the section/search filter so the jump lands
  // where the teacher is looking). null when nothing needs grading.
  const gradeNext = useMemo(() => pickGradeNext(filtered), [filtered]);

  // "Republish all" set — every homework with edited-but-unreleased
  // (dirty) grades, computed across the WHOLE inbox (unfiltered): the
  // publish-grades endpoint is HW-wide and idempotent, so this is a
  // global "flush my pending edits" action, not a per-section one.
  const dirtyBatch = useMemo(() => collectDirtyBatch(rows ?? []), [rows]);

  if (error) {
    return (
      <PageErrorState
        message="We couldn't load this right now."
        onRetry={retry}
      />
    );
  }

  if (rows === null) {
    return <InboxSkeleton />;
  }

  if (rows.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          title="Nothing submitted yet"
          description="Publish a homework and student work will land here for grading."
        />
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search homework"
            placeholder="Search homework"
            className="w-full rounded-[--radius-md] border border-border-light bg-surface py-2 pl-9 pr-3 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </div>
        <Select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          aria-label="Filter by section"
        >
          <option value="all">All sections</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      <BatchActionBar
        gradeNext={gradeNext}
        onGradeNext={() => {
          if (gradeNext) router.push(reviewHref(courseId, gradeNext.row));
        }}
        dirtyBatch={dirtyBatch}
        onRepublished={() =>
          load()
            .then(setRows)
            .catch((e) =>
              setError(e instanceof Error ? e.message : "Failed to refresh inbox"),
            )
        }
      />

      {filtered.length === 0 ? (
        <EmptyState title="No homework matches those filters" />
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
// Batch action bar — "Grade next" jump + "Republish all" fan-out. Only
// renders when at least one of the two has something to act on, so a
// caught-up inbox stays clean.
// ────────────────────────────────────────────────────────────────────

function BatchActionBar({
  gradeNext,
  onGradeNext,
  dirtyBatch,
  onRepublished,
}: {
  gradeNext: GradeNextTarget | null;
  onGradeNext: () => void;
  dirtyBatch: DirtyBatch;
  onRepublished: () => void;
}) {
  const reduce = useReducedMotion();
  const [confirming, setConfirming] = useState(false);
  const [republishing, setRepublishing] = useState(false);
  const [republishError, setRepublishError] = useState<string | null>(null);

  // Bulk republish only earns its place when MULTIPLE homeworks are
  // dirty — a single dirty HW is better handled by its own row / the
  // per-HW republish button in the review pane.
  const showRepublish = dirtyBatch.assignmentIds.length >= 2;

  if (!gradeNext && !showRepublish) return null;

  const handleRepublishAll = async () => {
    setRepublishing(true);
    setRepublishError(null);
    // Fan the existing HW-wide publish-grades endpoint across every
    // dirty homework. allSettled so one failure doesn't abort the rest;
    // we report the honest count of failures and still refresh so the
    // succeeded ones drop out of the list.
    const results = await Promise.allSettled(
      dirtyBatch.assignmentIds.map((id) => teacher.publishGrades(id, false)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    setRepublishing(false);
    if (failed > 0) {
      setRepublishError(
        failed === dirtyBatch.assignmentIds.length
          ? "Couldn’t republish — please try again."
          : `Republished some, but ${failed} ${failed === 1 ? "homework" : "homeworks"} failed. Try again.`,
      );
    } else {
      setConfirming(false);
    }
    onRepublished();
  };

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)] px-4 py-3">
        {/* Grade next */}
        {gradeNext ? (
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onGradeNext}
              className="shrink-0 rounded-[--radius-md] bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
            >
              Grade next →
            </button>
            <span className="min-w-0 truncate text-[11px] text-text-muted">
              {gradeNext.reason} ·{" "}
              <span className="font-semibold text-text-secondary">
                {gradeNext.row.assignment_title}
              </span>{" "}
              · {gradeNext.row.section_name}
            </span>
          </div>
        ) : (
          <span aria-hidden />
        )}

        {/* Republish all — inline confirm (republish pushes grades to
            students, so it asks first; the affordance stays calm, not
            alarming). */}
        {showRepublish && (
          <AnimatePresence mode="wait" initial={false}>
            {confirming ? (
              <motion.div
                key="confirm"
                initial={reduce ? false : { opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: 6 }}
                transition={{ duration: reduce ? 0 : 0.15 }}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="text-[11px] text-text-secondary">
                  Send {dirtyBatch.dirtyCount} updated{" "}
                  {dirtyBatch.dirtyCount === 1 ? "grade" : "grades"} to students
                  across {dirtyBatch.assignmentIds.length} homeworks
                  {dirtyBatch.pendingCount > 0 && (
                    <>
                      {" "}
                      <span className="text-text-muted">
                        (+{dirtyBatch.pendingCount} newly graded)
                      </span>
                    </>
                  )}
                  ?
                </span>
                <button
                  type="button"
                  onClick={handleRepublishAll}
                  disabled={republishing}
                  className="rounded-[--radius-sm] bg-[color:var(--color-warning-dark)] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[color:var(--color-warning)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {republishing ? "Republishing…" : "Yes, republish"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setRepublishError(null);
                  }}
                  disabled={republishing}
                  className="rounded-[--radius-sm] border border-border-light bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
                >
                  Cancel
                </button>
              </motion.div>
            ) : (
              <motion.button
                key="trigger"
                type="button"
                onClick={() => setConfirming(true)}
                initial={reduce ? false : { opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: 6 }}
                transition={{ duration: reduce ? 0 : 0.15 }}
                className="inline-flex items-center gap-1.5 rounded-[--radius-md] border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning-bg)] px-4 py-2 text-xs font-bold text-[color:var(--color-warning-dark)] transition-colors hover:border-[color:var(--color-warning)]/70 dark:bg-[color:var(--color-warning)]/10"
              >
                <span aria-hidden>↻</span>
                Republish all ({dirtyBatch.dirtyCount}) →
              </motion.button>
            )}
          </AnimatePresence>
        )}
      </div>
      {republishError && (
        <p className="mt-2 text-xs font-semibold text-[color:var(--color-error)]">
          {republishError}
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────

/**
 * Initial-load placeholder for the grading inbox. Mirrors the real
 * silhouette — a search/filter bar over a stack of inbox-row cards —
 * so the list settles in place rather than blanking to "Loading…".
 */
function InboxSkeleton() {
  return (
    <div className="mt-2" aria-busy="true" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 flex-1 min-w-[220px] rounded-[--radius-md]" />
        <Skeleton className="h-10 w-32 rounded-[--radius-md]" />
      </div>
      <div className="mt-5 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 rounded-[--radius-md] border border-border-light bg-surface px-4 py-3"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="h-1.5 w-3/5 rounded-full" />
            </div>
            <Skeleton className="h-8 w-24 rounded-[--radius-md]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function InboxRow({
  row,
  courseId,
}: {
  row: SubmissionsInboxRow;
  courseId: string;
}) {
  const href = reviewHref(courseId, row);
  const dueLabel = row.due_at ? formatDueShort(row.due_at) : "No due date";
  const overdueDays = row.due_at ? daysOverdue(row.due_at) : 0;
  // "To review" = anything that needs the teacher's attention before
  // students see grades — ungraded submissions, graded-but-unpublished
  // ones (`to_grade`), AND published-but-edited (`dirty`, needs a
  // republish click). `submitted - published` captures the first two
  // since `to_grade` only flags graded-but-unpublished and the truly-
  // ungraded would otherwise be silently dropped from the count
  // (per teacher_assignments.py:985-994). + dirty adds back the
  // republish-pending subset of published rows.
  const toReview = (row.submitted - row.published) + row.dirty;
  const hasOutstanding = toReview + row.flagged > 0;
  const isAwaiting = row.submitted === 0;

  // CTA copy escalates with what's actually pending: flagged rows
  // are the highest-leverage click, ungraded next, then plain Review.
  // Lets a teacher with 8 HWs in their inbox land on the most-urgent
  // one without scanning the row body.
  const ctaLabel =
    row.flagged > 0
      ? `Review ${row.flagged} flagged →`
      : toReview > 0
        ? `Grade ${toReview} →`
        : row.dirty > 0
          ? "Republish →"
          : "Review →";

  // Body content is identical between the link and waiting variants —
  // only the right-side CTA differs. Pulling it out keeps the two
  // branches scannable side-by-side.
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="min-w-0 truncate text-sm font-bold text-text-primary">
            {row.assignment_title}
          </h3>
          <span className="text-[11px] text-text-muted">·</span>
          <span className="shrink-0 text-xs text-text-secondary">{row.section_name}</span>
          {/* Status pills hop onto the title row so the teacher's eye
              picks up "what about this row?" before the meta line. Same
              tone vocabulary as the courses dashboard / course header
              status row — amber = needs me, red = harder failure. */}
          {toReview > 0 && (
            <StatusPill tone="amber" label={`${toReview} to grade`} />
          )}
          {row.flagged > 0 && (
            <StatusPill tone="red" label={`${row.flagged} flagged`} icon="⚑" />
          )}
          {!hasOutstanding &&
            row.submitted > 0 &&
            // "All reviewed" only when EVERYONE who was supposed to
            // submit has submitted AND every submission is published-
            // and-clean. Without the total_students gate, a 3-of-28
            // submitted HW with all 3 published shows a green
            // "All reviewed" pill while 25 students still owe work —
            // reads as "done with this HW" when the teacher is mostly
            // waiting on submitters.
            row.submitted >= row.total_students && (
              <StatusPill tone="green" label="All reviewed" icon="✓" />
            )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
          <span>{dueLabel}</span>
          {overdueDays > 0 && hasOutstanding && (
            <>
              <span aria-hidden>·</span>
              <span className="font-semibold text-[color:var(--color-error)]">
                {overdueDays === 1 ? "1 day overdue" : `${overdueDays} days overdue`}
              </span>
            </>
          )}
        </div>
        {isAwaiting ? (
          <p className="mt-2 text-[11px] italic text-text-muted">
            No work to review yet — open to preview the roster &amp; rubric
          </p>
        ) : (
          // Single summary line + a single bar showing overall grading
          // progress (published out of the whole class). Status pills
          // up top now carry the urgency signal, so this line stays
          // narrative ("3 of 28 submitted · 2 published") without
          // needing color emphasis on every number.
          <div className="mt-2 space-y-1.5">
            <p className="text-[11px] text-text-muted">
              <span className="font-semibold text-text-primary">
                {row.submitted}
              </span>{" "}
              of {row.total_students} submitted · {row.published} published
            </p>
            <ProgressBar
              label="Graded"
              current={row.published}
              total={row.total_students}
              color="green"
            />
          </div>
        )}
      </div>
      {isAwaiting ? (
        // Zero-submission rows used to be a dead end. They're now a
        // quiet link into the review pane so a teacher can preview the
        // roster and sanity-check before work lands.
        <span className="shrink-0 rounded-[--radius-md] border border-border-light bg-surface px-4 py-2 text-xs font-semibold text-text-secondary group-hover:border-primary/40 group-hover:text-text-primary">
          Preview →
        </span>
      ) : (
        <span className="shrink-0 rounded-[--radius-md] bg-primary px-4 py-2 text-xs font-bold text-white group-hover:bg-primary-dark">
          {ctaLabel}
        </span>
      )}
    </>
  );

  // Every row is now clickable — has-work rows jump into grading, and
  // zero-submission rows open the review pane to preview the roster.
  // The `group` hover affordance is shared; the awaiting variant just
  // carries a calmer right-side label.
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-3 rounded-[--radius-md] border border-border-light bg-surface px-4 py-3 transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-sm"
    >
      {body}
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
  // "Outstanding" mirrors the per-row "to review" math: anything that
  // needs teacher attention before grades release. Using to_grade +
  // dirty alone would silently sink HWs with ungraded submissions
  // (final_score IS NULL — not in to_grade) to the bottom of the
  // inbox. (submitted - published) catches both ungraded and to_grade.
  const aOutstanding = (a.submitted - a.published) + a.dirty + a.flagged;
  const bOutstanding = (b.submitted - b.published) + b.dirty + b.flagged;
  const aWork = aOutstanding > 0 ? 0 : 1;
  const bWork = bOutstanding > 0 ? 0 : 1;
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

// ────────────────────────────────────────────────────────────────────
// Batch-action derivations
// ────────────────────────────────────────────────────────────────────

type GradeNextTarget = { row: SubmissionsInboxRow; reason: string };

/** Priority tier for the "Grade next" jump. Lower = more urgent.
 *  Mirrors the audit's flagged → ungraded-overdue → ungraded order.
 *  Dirty-only rows return null — republishing edited grades is the
 *  Republish-all action's job, not a grading jump. */
function gradeNextTier(r: SubmissionsInboxRow): number | null {
  if (r.flagged > 0) return 0;
  // Ungraded = needs a grade or a first publish. Excludes `dirty`
  // (which lives inside `published`), so a clean-but-edited row never
  // pulls "Grade next".
  const ungraded = r.submitted - r.published;
  if (ungraded > 0) {
    return r.due_at && daysOverdue(r.due_at) > 0 ? 1 : 2;
  }
  return null;
}

function pickGradeNext(rows: SubmissionsInboxRow[]): GradeNextTarget | null {
  let best: SubmissionsInboxRow | null = null;
  let bestTier = Number.POSITIVE_INFINITY;
  let bestDue = Number.POSITIVE_INFINITY;
  for (const r of rows) {
    const tier = gradeNextTier(r);
    if (tier === null) continue;
    const due = dueKey(r);
    if (tier < bestTier || (tier === bestTier && due < bestDue)) {
      best = r;
      bestTier = tier;
      bestDue = due;
    }
  }
  if (!best) return null;
  const reason =
    best.flagged > 0
      ? `⚑ ${best.flagged} flagged`
      : bestTier === 1
        ? `${best.submitted - best.published} to grade · overdue`
        : `${best.submitted - best.published} to grade`;
  return { row: best, reason };
}

type DirtyBatch = {
  /** Distinct homework ids with edited-but-unreleased grades. The
   *  publish-grades endpoint is HW-wide, so we fan out over these, not
   *  over rows (a HW can span several section rows). */
  assignmentIds: string[];
  /** Total dirty grades across those homeworks — the "(N)" count. */
  dirtyCount: number;
  /** Freshly graded-but-never-published grades on the same homeworks.
   *  The endpoint publishes these alongside the dirty ones, so the
   *  confirm discloses them honestly. */
  pendingCount: number;
};

function collectDirtyBatch(rows: SubmissionsInboxRow[]): DirtyBatch {
  const ids = new Set<string>();
  let dirtyCount = 0;
  // First pass: which homeworks have any dirty grade, and the total
  // dirty count.
  for (const r of rows) {
    if (r.dirty > 0) {
      ids.add(r.assignment_id);
      dirtyCount += r.dirty;
    }
  }
  // Second pass: pending (graded-but-unpublished) grades that live on
  // the same homeworks and would publish in the same fan-out. `to_grade`
  // is exactly the graded-but-unpublished count per row.
  let pendingCount = 0;
  for (const r of rows) {
    if (ids.has(r.assignment_id)) pendingCount += r.to_grade;
  }
  return { assignmentIds: Array.from(ids), dirtyCount, pendingCount };
}
