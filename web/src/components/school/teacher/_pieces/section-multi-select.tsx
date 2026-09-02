"use client";

import { useEffect, useState } from "react";
import { teacher, type TeacherSection } from "@/lib/api";

// Compact multi-select for picking 0+ sections to assign a homework
// to. Mirrors UnitMultiSelect's chip pattern. Unlike units (≥1
// required), sections can be empty during draft — the publish gating
// requires ≥1 at publish time, not at create time.
export function SectionMultiSelect({
  courseId,
  selected,
  onChange,
  disabled = false,
  sections: providedSections,
}: {
  courseId: string;
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Supplied when the parent already holds the course's sections — the
   *  homework page needs them for its own header, and two fetches of
   *  the same list is two chances to disagree. Omitted by the creation
   *  wizard, which has no reason to load them itself. */
  sections?: TeacherSection[] | null;
}) {
  const [fetched, setFetched] = useState<TeacherSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sections = providedSections !== undefined ? providedSections : fetched;

  useEffect(() => {
    if (providedSections !== undefined) return;
    let cancelled = false;
    teacher
      .sections(courseId)
      .then((res) => {
        if (cancelled) return;
        setFetched(res.sections);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load sections");
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, providedSections]);

  const toggle = (id: string) => {
    if (disabled) return;
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    onChange(next);
  };

  if (error) {
    return <p className="text-xs text-red-600">{error}</p>;
  }
  if (sections === null) {
    return <p className="text-xs text-text-muted">Loading sections…</p>;
  }
  if (sections.length === 0) {
    return (
      <p className="text-xs text-text-muted italic">
        No sections in this course yet. Create one in the Sections tab first.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {sections.map((s) => {
        const active = selected.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            disabled={disabled}
            className={`rounded-[--radius-pill] border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
              active
                ? "border-primary bg-primary text-white"
                : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:bg-bg-subtle"
            }`}
          >
            {active && <span className="mr-1">✓</span>}
            {s.name}
            <span className={`ml-1.5 text-[10px] ${active ? "opacity-80" : "opacity-60"}`}>
              {s.student_count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
