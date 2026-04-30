"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { teacher, type BankItem } from "@/lib/api";
import { WorkshopModal } from "@/components/school/teacher/workshop-modal";

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
  useEffect(() => {
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

  // Auto-append: while a gen job seeded by the wizard is still in
  // flight, poll pending and feed any new items to WorkshopModal so
  // the queue grows behind the teacher as they review. Reads job ids
  // from the same sessionStorage key the editor populates; stops the
  // moment every job reaches a terminal state.
  useEffect(() => {
    if (phase.kind !== "ready" || !assignmentType) return;
    const raw = sessionStorage.getItem(`hw-gen-${assignmentId}`);
    if (!raw) return;
    let jobIds: string[] = [];
    try {
      jobIds = JSON.parse(raw) as string[];
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
        setPhase((p) => (p.kind === "ready" ? { ...p, items } : p));
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
          className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-primary"
        >
          ← Back to homework
        </Link>
        {hwTitle && (
          <h1 className="mt-1 text-xl font-extrabold tracking-tight text-text-primary">
            {hwTitle}
          </h1>
        )}
      </div>

      {phase.kind === "loading" && (
        <p className="mx-auto mt-8 max-w-6xl px-4 text-sm text-text-muted">
          Loading queue…
        </p>
      )}

      {phase.kind === "error" && (
        <p className="mx-auto mt-8 max-w-6xl px-4 text-sm text-red-600">
          {phase.message}
        </p>
      )}

      {phase.kind === "empty" && (
        <div className="mx-auto mt-8 max-w-3xl px-4">
          <div className="rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle p-10 text-center">
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
