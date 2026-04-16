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
 * Renders the existing `WorkshopModal` (in queue mode, page variant)
 * as the item card so teachers get the full edit + AI chat + undo +
 * make-similar experience they had pre-Feature-7b — just on a
 * dedicated page instead of in a cramped modal.
 *
 * Variations (`parent_question_id` set) are filtered out — they're
 * practice scaffolding approved separately via "Make similar" on the
 * primary, not primary HW content.
 */
export default function HomeworkReviewPage({
  params,
}: {
  params: Promise<{ id: string; hwId: string }>;
}) {
  const { id: courseId, hwId: assignmentId } = use(params);
  const router = useRouter();
  const backHref = `/school/teacher/courses/${courseId}/homework/${assignmentId}`;
  const goBack = useCallback(() => router.push(backHref), [router, backHref]);

  const [items, setItems] = useState<BankItem[] | null>(null);
  const [hwTitle, setHwTitle] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      teacher.bank(courseId, { status: "pending", assignment_id: assignmentId }),
      teacher.assignment(assignmentId),
    ])
      .then(([b, a]) => {
        if (cancelled) return;
        setItems(b.items.filter((i) => i.parent_question_id === null));
        setHwTitle(a.title);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load queue");
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, assignmentId]);

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

      {items === null && !error && (
        <p className="mx-auto mt-8 max-w-6xl px-4 text-sm text-text-muted">
          Loading queue…
        </p>
      )}

      {error && (
        <p className="mx-auto mt-8 max-w-6xl px-4 text-sm text-red-600">{error}</p>
      )}

      {items !== null && items.length === 0 && (
        <div className="mx-auto mt-8 max-w-3xl px-4">
          <div className="rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle p-10 text-center">
            <p className="text-sm font-bold text-text-primary">Nothing to review.</p>
            <p className="mt-1 text-xs text-text-muted">
              Generate problems from the homework page to queue them here.
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

      {items !== null && items.length > 0 && (
        <div className="mt-3">
          <WorkshopModal
            queue={items}
            renderAsPage
            onClose={goBack}
            onChanged={() => {
              // The workshop updates individual items in-place; we
              // don't need to re-fetch the queue. When the teacher
              // finishes, WorkshopModal renders its own completion
              // screen and then calls onClose → goBack.
            }}
          />
        </div>
      )}
    </div>
  );
}
