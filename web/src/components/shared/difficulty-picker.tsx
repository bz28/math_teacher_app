"use client";

import { cn } from "@/lib/utils";

export type Difficulty = "easier" | "same" | "harder";

const OPTIONS: { id: Difficulty; label: string }[] = [
  { id: "easier", label: "Easier" },
  { id: "same",   label: "Same" },
  { id: "harder", label: "Harder" },
];

interface DifficultyPickerProps {
  value: Difficulty;
  onChange: (value: Difficulty) => void;
}

export function DifficultyPicker({ value, onChange }: DifficultyPickerProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-text-muted">Difficulty:</span>
      <div className="flex rounded-full border border-border bg-surface p-0.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              value === opt.id
                ? "bg-primary text-white"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
