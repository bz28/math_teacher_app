"use client";

import { useEffect, useState } from "react";
import { teacher, type TeacherUnit } from "@/lib/api";
import { topUnits } from "@/lib/units";
import { SelectableChip } from "./selectable-chip";

// Compact multi-select for picking 1+ units. Used by the homework
// creation flows. Single-select is the dominant case (a HW for one
// unit) but multi-select supports midterms / review HWs that span
// units. Required: enforces ≥1 unit at submit time via the parent's
// validation.
//
// Only top-level units are pickable. Subfolders inside a unit are
// organizational (like "math / algebra") and don't make sense as
// standalone HW targets — a homework belongs to "math", not to
// "math / algebra".
export function UnitMultiSelect({
  courseId,
  selected,
  onChange,
  disabled = false,
}: {
  courseId: string;
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [units, setUnits] = useState<TeacherUnit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    teacher
      .units(courseId)
      .then((res) => {
        if (cancelled) return;
        setUnits(res.units);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load units");
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

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
  if (units === null) {
    return <p className="text-xs text-text-muted">Loading units…</p>;
  }
  if (units.length === 0) {
    return (
      <p className="text-xs italic text-text-muted">
        No units yet. Create one in the Materials tab first.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {topUnits(units).map((top) => (
        <SelectableChip
          key={top.id}
          label={top.name}
          selected={selected.includes(top.id)}
          disabled={disabled}
          onToggle={() => toggle(top.id)}
        />
      ))}
    </div>
  );
}
