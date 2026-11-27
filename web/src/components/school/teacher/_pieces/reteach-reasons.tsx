"use client";

import { useState } from "react";
import Link from "next/link";
import type { InsightsProblem } from "@/lib/api";

/**
 * "Why points came off" under a flagged Insights problem: the most
 * common reasons, grouped from the teacher's own approved feedback by
 * the grading drain ahead of time (api/core/reteach_reasons.py). Each
 * reason opens the students behind it, each a link to their paper on
 * the review page, opened on this problem.
 */
export function ReteachReasons({
  problem,
  reviewHref,
}: {
  problem: InsightsProblem;
  /** The period's review page for this homework. */
  reviewHref: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (problem.reasons.length === 0 && !problem.reasons_pending) return null;

  return (
    <div className="col-start-2 col-end-[-1] rounded-[--radius-md] bg-bg-subtle px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
        Why points came off &middot; from your approved feedback
      </p>
      {problem.reasons.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-text-muted">
          Grouping your feedback. Reasons show up here a few minutes after you
          approve grades.
        </p>
      ) : (
        <ul className="mt-1.5">
          {problem.reasons.map((r, i) => {
            const expanded = open === i;
            const listId = `reasons-${problem.bank_item_id}-${i}`;
            return (
              <li key={r.label}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={listId}
                  onClick={() => setOpen(expanded ? null : i)}
                  className="grid w-full grid-cols-[1fr_auto] items-baseline gap-3 rounded-[--radius-sm] py-1 text-left text-sm leading-snug text-text-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span>{r.label}</span>
                  <span className="inline-flex items-baseline gap-1.5 tabular-nums text-[13px] font-semibold">
                    {r.count}
                    <span className="sr-only">
                      {r.count === 1 ? " student" : " students"}
                    </span>
                    <Caret open={expanded} />
                  </span>
                </button>
                {expanded && (
                  <ul
                    id={listId}
                    className="mb-1.5 mt-0.5 flex flex-wrap gap-1.5"
                  >
                    {r.students.map((s) => (
                      <li key={s.submission_id}>
                        <Link
                          href={`${reviewHref}?student=${s.id}&problem=${problem.position}`}
                          className="inline-block rounded-[--radius-pill] border border-border-light bg-surface px-2.5 py-0.5 text-[12px] font-medium text-text-secondary hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          {s.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      className={`h-3 w-3 shrink-0 self-center text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  );
}
