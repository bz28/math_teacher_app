"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { teacher, type BankItem } from "@/lib/api";
import { WorkshopModal } from "@/components/school/teacher/workshop-modal";
import { PageErrorState } from "@/components/ui/page-error-state";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Full-page approval queue for a homework's generated problems.
 *
 * Route: /school/teacher/courses/[id]/homework/[hwId]/review
 *
 * Renders the existing `WorkshopModal` (queue mode, page variant) as
 * the item card so teachers get the full edit + AI chat + undo +
 * make-similar experience — just on a dedicated page.
 *
 * Entry point is the pending banner on the homework editor (which
 * only appears when there are items to approve), so an empty queue
 * here means generation failed or the queue was drained between
 * banner click and page load — we surface that as the empty state.
 *
 * Variations (`parent_question_id` set) are filtered out — they're
 * practice scaffolding approved separately via "Make similar" on the
 * primary, not primary HW content.
 */

// Auto-append polling: refresh pending every few seconds while a
// gen job is still feeding items into the queue. The ceiling caps
// the polling lifespan in case a job stalls without ever reaching
// "done"/"failed".
const QUEUE_AUTOAPPEND_INTERVAL_MS = 4_000;
const QUEUE_AUTOAPPEND_CEILING_MS = 5 * 60_000;

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; items: BankItem[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export default function HomeworkReviewPage({
  params,
}: {
  params: Promise<{ id: string; hwId: string }>;
}) {
  const { id: courseId, hwId: assignmentId } = use(params);
  const router = useRouter();
  const backHref = `/school/teacher/courses/${courseId}/homework/${assignmentId}`;
  const goBack = useCallback(() => router.push(backHref), [router, backHref]);

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [hwTitle, setHwTitle] = useState<string>("");
  // Cached so the auto-append polling effect can re-run fetchPending
  // without re-fetching the assignment each tick.
  const [assignmentType, setAssignmentType] = useState<string | null>(null);

  const fetchPending = useCallback(
    async (assignmentType: string): Promise<BankItem[]> => {
      const res = await teacher.bank(courseId, {
        status: "pending",
        assignment_id: assignmentId,
      });
      // Practice items are variations by design (clone-from-HW
      // parents each one on a source HW primary), so skip the
      // variation filter for practice — otherwise we'd drop every
      // item produced. For HW review, the filter still matters: it
      // hides "generate similar" scaffolding attached to an existing
      // primary.
      if (assignmentType === "practice") {
        return res.items;
      }
      return res.items.filter((i) => i.parent_question_id === null);
    },
    [courseId, assignmentId],
  );

  // Initial load — fetch HW title/type + pending snapshot. We fetch
  // the assignment first so the pending query knows which filter to
  // apply; otherwise a practice clone would get an empty list on
  // first load (the type=null branch would drop every variation).
  // Extracted into a callable so the error state can offer Retry
  // without a full page refresh. The caller sets phase back to
  // "loading" (the retry handler does; the mount phase already starts
  // there) — keeping setState out of the effect body.
  const load = useCallback(() => {
    let cancelled = false;
    teacher
      .assignment(assignmentId)
      .then(async (a) => {
        if (cancelled) return;
        setHwTitle(a.title);
        setAssignmentType(a.type);
        const items = await fetchPending(a.type);
        if (cancelled) return;
        setPhase(items.length > 0 ? { kind: "ready", items } : { kind: "empty" });
      })
      .catch((e) => {
        if (cancelled) return;
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : "Failed to load queue",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, fetchPending]);

  useEffect(() => load(), [load]);

  // Auto-append: while a gen job seeded by the wizard is still in
  // flight, poll pending and feed any new items to WorkshopModal so
  // the queue grows behind the teacher as they review. Also runs in
  // the empty phase so a teacher who landed before any item produced
  // (e.g., refresh / bookmark / direct-URL during gen) sees the
  // queue auto-upgrade to "ready" the moment the first item lands —
  // not stuck on the empty-state copy until manual refresh. Reads
  // job ids from the same sessionStorage key the editor populates;
  // stops the moment every job reaches a terminal state.
  useEffect(() => {
    if (phase.kind !== "ready" && phase.kind !== "empty") return;
    if (!assignmentType) return;
    const raw = sessionStorage.getItem(`hw-gen-${assignmentId}`);
    if (!raw) return;
    let jobIds: string[];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        !Array.isArray(parsed) ||
        !parsed.every((x) => typeof x === "string")
      ) {
        return;
      }
      jobIds = parsed;
    } catch {
      return;
    }
    if (jobIds.length === 0) return;

    const startedAt = Date.now();
    const interval = window.setInterval(async () => {
      if (Date.now() - startedAt > QUEUE_AUTOAPPEND_CEILING_MS) {
        window.clearInterval(interval);
        return;
      }
      try {
        const jobs = await Promise.all(
          jobIds.map((id) => teacher.bankJob(courseId, id)),
        );
        const stillRunning = jobs.some(
          (j) => j.status !== "done" && j.status !== "failed",
        );
        const items = await fetchPending(assignmentType);
        setPhase((p) => {
          if (p.kind === "ready") return { ...p, items };
          if (p.kind === "empty" && items.length > 0) {
            return { kind: "ready", items };
          }
          return p;
        });
        if (!stillRunning) {
          window.clearInterval(interval);
        }
      } catch {
        // Transient — keep polling.
      }
    }, QUEUE_AUTOAPPEND_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [phase.kind, assignmentId, courseId, fetchPending, assignmentType]);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 pt-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted transition-colors hover:text-text-primary"
        >
          ← Back to homework
        </Link>
        {hwTitle && (
          <h1 className="mt-2 font-serif text-[32px] leading-tight tracking-[-0.015em] text-text-primary">
            {hwTitle}
          </h1>
        )}
      </div>

      {phase.kind === "loading" && <QueueSkeleton />}

      {phase.kind === "error" && (
        <div className="mx-auto mt-8 max-w-6xl px-4">
          <PageErrorState
            message="We couldn't load this right now."
            onRetry={() => {
              setPhase({ kind: "loading" });
              load();
            }}
          />
        </div>
      )}

      {phase.kind === "empty" && (
        <div className="mx-auto mt-8 max-w-3xl px-4">
          <div className="rounded-[--radius-xl] border border-border-light bg-[color:var(--color-surface-alt-2)] p-10 text-center">
            <p className="text-sm font-bold text-text-primary">Nothing to review yet.</p>
            <p className="mt-1 text-xs text-text-muted">
              Problems may still be generating, or you&apos;ve already reviewed
              them. Head back to the homework page to check status — the
              generating indicator there shows live progress.
            </p>
            <Link
              href={backHref}
              className="mt-5 inline-block rounded-[--radius-md] bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary-dark"
            >
              ← Back to homework
            </Link>
          </div>
        </div>
      )}

      {phase.kind === "ready" && (
        <div className="mt-3">
          <WorkshopModal
            queue={phase.items}
            renderAsPage
            onClose={goBack}
            onChanged={() => {
              // WorkshopModal updates individual items in-place and
              // handles queue advance internally; we don't need to
              // refetch.
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Initial-load placeholder for the review queue. Mirrors THIS page's
 * settled layout — the WorkshopModal `renderAsPage` full-width work
 * pane (header row → thin progress bar → single work column → mode-line
 * footer), NOT the two-column sections layout — so the page settles in
 * place rather than popping when the first item lands.
 */
function QueueSkeleton() {
  return (
    <div
      className="mt-3"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="mx-auto max-w-6xl px-4 pb-10">
        <div className="flex w-full flex-col overflow-hidden rounded-[--radius-xl] border border-border-light bg-surface shadow-sm">
          {/* Header row — title + queue counter + status badge · action */}
          <div className="flex items-center justify-between gap-3 border-b border-border-light px-6 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-16 rounded-[--radius-pill]" />
            </div>
            <Skeleton className="h-8 w-28 rounded-[--radius-md]" />
          </div>
          {/* Thin progress bar */}
          <div className="h-1 bg-bg-subtle">
            <div className="h-full w-1/4 bg-primary/30" />
          </div>
          {/* Single work column — question card + solution toggle */}
          <div className="flex flex-1 flex-col md:flex-row">
            <div className="flex-1 px-6 py-5">
              <div className="rounded-[--radius-lg] border border-border-light bg-surface p-5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-4 h-5 w-full" />
                <Skeleton className="mt-2.5 h-5 w-11/12" />
                <Skeleton className="mt-2.5 h-5 w-2/3" />
              </div>
              <div className="mt-6">
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          </div>
          {/* Mode-line footer — status text + action buttons */}
          <div className="flex items-center justify-between gap-3 border-t border-border-light px-6 py-3">
            <Skeleton className="h-4 w-44" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-24 rounded-[--radius-md]" />
              <Skeleton className="h-9 w-24 rounded-[--radius-md]" />
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only">Loading review queue…</span>
    </div>
  );
}
