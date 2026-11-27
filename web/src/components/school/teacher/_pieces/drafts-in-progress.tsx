"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { teacher, type DraftHomework } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { draftDetail } from "./draft-detail";

/** Home's quiet line under "Needs you today": homework the teacher
 *  started and hasn't published, one click back in. Nothing when there's
 *  none, and nothing if the read fails — the queue above is what home is
 *  for, and every draft is still in its course's Homework tab. */
export function DraftsInProgress() {
  const [data, setData] = useState<{ drafts: DraftHomework[]; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    teacher
      .drafts()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || data.drafts.length === 0) return null;
  const more = data.total - data.drafts.length;
  return (
    <section className="mt-8" aria-labelledby="drafts-in-progress">
      <h2
        id="drafts-in-progress"
        className="font-serif text-[20px] leading-tight tracking-[-0.01em] text-text-primary"
      >
        Drafts in progress
      </h2>
      <ul className="mt-3 overflow-hidden rounded-[--radius-md] border border-border-light bg-surface">
        {data.drafts.map((d) => (
          <li
            key={d.assignment_id}
            className="flex flex-col gap-2 border-b border-border-light px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
          >
            <div className="min-w-0 flex-1">
              <p className="break-words text-[14.5px] font-semibold text-text-primary">{d.title}</p>
              <p className="mt-0.5 text-[12.5px] text-text-secondary">
                {draftDetail(d, d.due_at ? formatDate(d.due_at) : null)}
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
        ))}
      </ul>
      {more > 0 && (
        <p className="mt-2 text-xs text-text-muted">
          {more} more in your courses&rsquo; Homework tabs
        </p>
      )}
    </section>
  );
}
