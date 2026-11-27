"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import type { Drafts } from "@/lib/api";
import { draftDue, draftLeft } from "./draft-detail";

/** Home's quiet line under "Needs you today": homework the teacher
 *  started and hasn't published, one click back in. Nothing when there's
 *  none (the page leaves it out if the read fails — every draft is still
 *  in its course's Homework tab). */
export function DraftsInProgress({ drafts, total }: Drafts) {
  const [now] = useState(() => Date.now());
  if (drafts.length === 0) return null;
  const more = total - drafts.length;
  return (
    <section className="mt-8" aria-labelledby="drafts-in-progress">
      <h2
        id="drafts-in-progress"
        className="font-serif text-[20px] leading-tight tracking-[-0.01em] text-text-primary"
      >
        Drafts in progress
      </h2>
      <ul className="mt-3 overflow-hidden rounded-[--radius-md] border border-border-light bg-surface">
        {drafts.map((d) => {
          const due = draftDue(d.due_at, now, (iso) => formatDate(iso) ?? iso);
          return (
          <li
            key={d.assignment_id}
            className="flex flex-col gap-2 border-b border-border-light px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
          >
            <div className="min-w-0 flex-1">
              <p className="break-words text-[14.5px] font-semibold text-text-primary">{d.title}</p>
              <p className="mt-0.5 text-[12.5px] text-text-secondary">
                {d.course_name}
                {due && (
                  <span className={due.passed ? "text-[color:var(--color-error)]" : undefined}>
                    {" · "}
                    {due.text}
                  </span>
                )}
                {" · "}
                {draftLeft(d)}
              </p>
            </div>
            <Link
              href={`/school/teacher/courses/${d.course_id}/homework/${d.assignment_id}`}
              aria-label={`Continue ${d.title}`}
              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-[--radius-sm] border border-border bg-surface px-3 py-1.5 text-[13px] font-semibold text-text-primary transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:self-auto"
            >
              Continue
            </Link>
          </li>
          );
        })}
      </ul>
      {more > 0 && (
        <p className="mt-2 text-xs text-text-muted">
          {more} more in your courses&rsquo; Homework tabs
        </p>
      )}
    </section>
  );
}
