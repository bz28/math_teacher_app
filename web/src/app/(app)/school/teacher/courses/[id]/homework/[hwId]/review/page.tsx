"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
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
 * Landing here straight from "Create & generate" is expected: when
 * the queue loads empty but a recent gen is in flight, we enter
 * "waiting" mode — skeleton cards + poll every few seconds until
 * items arrive (or a ceiling is hit).
 *
 * Variations (`parent_question_id` set) are filtered out — they're
 * practice scaffolding approved separately via "Make similar" on the
 * primary, not primary HW content.
 */
const POLL_INTERVAL_MS = 3_000;
const POLL_CEILING_MS = 120_000; // 2 minutes — generous cover for AI latency.

type Phase =
  | { kind: "loading" }
  | { kind: "waiting"; since: number }
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
  // Type of the assignment being reviewed. Drives the variation
  // filter: homework primaries have parent_question_id=null, so we
  // filter out anything with a parent (those are "generate similar"
  // practice scaffolding attached to a specific primary). Practice
  // assignments cloned from a HW are the INVERSE case — every item
  // is a variation of a source HW primary, so the filter would eat
  // all of them. Hydrated from the initial assignment fetch.
  const [assignmentType, setAssignmentType] = useState<string | null>(null);
  // Ref so the polling effect's async callbacks can check the freshest
  // phase without re-subscribing when phase changes mid-poll. Sync the
  // ref from an effect — writing to refs during render is disallowed
  // by react-hooks/refs. A one-commit delay is fine here because the
  // readers (async .then callbacks) only fire after the render that
  // triggered a phase change has flushed and run its effects.
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const fetchPending = useCallback(async (): Promise<BankItem[]> => {
    const res = await teacher.bank(courseId, {
      status: "pending",
      assignment_id: assignmentId,
    });
    // Practice items are variations by design (clone-from-HW parents
    // each one on a source HW primary), so skip the variation filter
    // for practice — otherwise we'd drop every item produced. For HW
    // review, the filter still matters: it hides "generate similar"
    // scaffolding attached to an existing primary.
    if (assignmentType === "practice") {
      return res.items;
    }
    return res.items.filter((i) => i.parent_question_id === null);
  }, [courseId, assignmentId, assignmentType]);

  // Initial load — fetch HW title/type + first pending snapshot.
  // We fetch the assignment first so the pending query knows which
  // filter to apply; otherwise a practice clone would get an empty
  // list on first load (fetchPending's closure would see type=null
  // and drop every variation item).
  useEffect(() => {
    let cancelled = false;
    teacher
      .assignment(assignmentId)
      .then(async (a) => {
        if (cancelled) return;
        setHwTitle(a.title);
        setAssignmentType(a.type);
        const res = await teacher.bank(courseId, {
          status: "pending",
          assignment_id: assignmentId,
        });
        const items =
          a.type === "practice"
            ? res.items
            : res.items.filter((i) => i.parent_question_id === null);
        if (cancelled) return;
        if (items.length > 0) {
          setPhase({ kind: "ready", items });
        } else {
          // Empty on first load → assume generation might be in
          // flight. Start polling. If nothing arrives before the
          // ceiling, we flip to the empty-state message.
          setPhase({ kind: "waiting", since: Date.now() });
        }
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
  }, [courseId, assignmentId]);

  // Poll while waiting.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const startedAt = phase.since;
    const interval = window.setInterval(async () => {
      // Give up after the ceiling — probably a failed gen or zero
      // usable items.
      if (Date.now() - startedAt > POLL_CEILING_MS) {
        if (phaseRef.current.kind === "waiting") {
          setPhase({ kind: "empty" });
        }
        return;
      }
      try {
        const items = await fetchPending();
        if (items.length > 0 && phaseRef.current.kind === "waiting") {
          setPhase({ kind: "ready", items });
        }
      } catch {
        // Transient error — keep polling.
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [phase, fetchPending]);

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

      {phase.kind === "waiting" && <GeneratingState backHref={backHref} />}

      {phase.kind === "empty" && (
        <div className="mx-auto mt-8 max-w-3xl px-4">
          <div className="rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle p-10 text-center">
            <p className="text-sm font-bold text-text-primary">Nothing to review.</p>
            <p className="mt-1 text-xs text-text-muted">
              No problems showed up — the generation may have failed or produced
              no usable questions.
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

// ────────────────────────────────────────────────────────────────────
// Generating state — shown while pending is empty but a gen job is
// presumably in flight. Skeleton cards + a friendly header so the
// teacher knows problems are on the way.
// ────────────────────────────────────────────────────────────────────

function GeneratingState({ backHref }: { backHref: string }) {
  return (
    <div className="mx-auto mt-4 max-w-4xl px-4">
      <div className="rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
          </span>
          <h2 className="text-base font-bold text-text-primary">
            Generating your problems…
          </h2>
        </div>
        <p className="mt-1 text-xs text-text-muted">
          The AI is working on this. Problems usually appear in about 30
          seconds. They&apos;ll show up here the moment the first one is ready.
        </p>

        <div className="mt-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} delay={i} />
          ))}
        </div>

        <div className="mt-5 text-right">
          <Link
            href={backHref}
            className="text-xs font-semibold text-text-muted hover:text-text-primary"
          >
            I&apos;ll wait on the homework page →
          </Link>
        </div>
      </div>
    </div>
  );
}

function SkeletonCard({ delay }: { delay: number }) {
  // Stagger the pulse so the card row feels alive rather than a
  // monolithic single-pulse block.
  const style = { animationDelay: `${delay * 120}ms` };
  return (
    <div className="rounded-[--radius-md] border border-border-light bg-bg-base/60 p-4">
      <div className="flex items-start gap-3">
        <div
          className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-bg-subtle"
          style={style}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div
            className="h-3 w-5/6 animate-pulse rounded bg-bg-subtle"
            style={style}
          />
          <div
            className="h-3 w-11/12 animate-pulse rounded bg-bg-subtle"
            style={style}
          />
          <div
            className="h-3 w-3/5 animate-pulse rounded bg-bg-subtle"
            style={style}
          />
        </div>
      </div>
    </div>
  );
}
