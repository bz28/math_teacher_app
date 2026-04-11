"use client";

import { SUBJECT_CONFIG } from "@/lib/constants";
import type { Subject } from "@/stores/learn";
import { cn } from "@/lib/utils";

const SUBJECTS: Subject[] = ["math", "physics", "chemistry"];

interface SubjectPillsProps {
  active: Subject;
  onChange: (subject: Subject) => void;
}

/**
 * Horizontal row of subject pills. The active pill renders its own
 * subject gradient; inactive pills use the surface card style. This
 * mirrors `mobile/src/components/SubjectPills.tsx`.
 */
export function SubjectPills({ active, onChange }: SubjectPillsProps) {
  return (
    <div
      className="flex gap-2 overflow-x-auto px-5 py-2"
      role="tablist"
      aria-label="Subject"
    >
      {SUBJECTS.map((s) => {
        const cfg = SUBJECT_CONFIG[s];
        const isActive = s === active;
        return (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(s)}
            className={cn(
              // min-h-11 (44px) meets tap-target guidance
              "inline-flex min-h-11 flex-shrink-0 items-center gap-1.5 rounded-[--radius-pill] px-4 py-2.5 text-sm font-bold transition-all",
              isActive
                ? cn("text-white shadow-md", cfg.gradient)
                : "border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary",
            )}
          >
            <span aria-hidden>{cfg.icon}</span>
            <span>{cfg.name}</span>
          </button>
        );
      })}
    </div>
  );
}
