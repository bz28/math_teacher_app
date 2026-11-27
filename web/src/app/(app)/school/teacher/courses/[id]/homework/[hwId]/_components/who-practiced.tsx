"use client";

import { useState } from "react";
import type { PracticedSection } from "@/lib/api";

/**
 * Who has practiced a published set, one line per period: "11 of 25 in
 * Period 1 practiced", with the students who haven't behind a click.
 * Ungraded and teacher-only: no scores, no outcomes.
 */
export function WhoPracticed({ sections }: { sections: PracticedSection[] }) {
  if (sections.length === 0) return null;
  return (
    <section
      aria-label="Who practiced"
      className="mt-4 rounded-[--radius-md] border border-border-light bg-surface px-4 py-3"
    >
      <ul className="space-y-2">
        {sections.map((s) => (
          <PeriodLine key={s.section_id} section={s} />
        ))}
      </ul>
      <p className="mt-2 text-xs text-text-muted">
        Counts students who opened the set and answered at least one problem.
        Practice isn&apos;t graded.
      </p>
    </section>
  );
}

function PeriodLine({ section }: { section: PracticedSection }) {
  const [open, setOpen] = useState(false);
  const listId = `not-yet-${section.section_id}`;
  const left = section.not_yet.length;
  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-text-primary">
          <span className="font-semibold tabular-nums">
            {section.practiced} of {section.students}
          </span>{" "}
          in {section.section_name} practiced
        </p>
        {left > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
            className="text-xs font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {open ? "Hide" : "Show"} who hasn&apos;t ({left}) <span aria-hidden>{open ? "▴" : "▾"}</span>
          </button>
        )}
      </div>
      {open && (
        <ul id={listId} className="mt-1.5 flex flex-wrap gap-1.5">
          {section.not_yet.map((st) => (
            <li
              key={st.id}
              className="rounded-[--radius-pill] border border-border-light bg-bg-subtle px-2.5 py-0.5 text-[12px] font-medium text-text-secondary"
            >
              {st.name}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
