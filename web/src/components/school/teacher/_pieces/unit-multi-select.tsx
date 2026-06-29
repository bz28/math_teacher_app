"use client";

import { useCallback, useEffect, useState } from "react";
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
  // Inline unit creation — so a teacher making their FIRST homework in a fresh
  // course doesn't have to bail to the Materials tab and reopen. Mirrors the
  // Materials tab's create (teacher.createUnit).
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

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

  const createUnit = useCallback(async () => {
    const name = newName.trim();
    if (!name || creating || disabled) return;
    setCreating(true);
    setError(null);
    try {
      const created = await teacher.createUnit(courseId, { name });
      // Reload the canonical list (full TeacherUnit shape) rather than guess it.
      const res = await teacher.units(courseId);
      setUnits(res.units);
      onChange([...selected, created.id]); // auto-select the new unit
      setNewName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create unit");
    } finally {
      setCreating(false);
    }
  }, [newName, creating, disabled, courseId, selected, onChange]);

  if (error && units === null) {
    return <p className="text-xs text-red-600">{error}</p>;
  }
  if (units === null) {
    return <p className="text-xs text-text-muted">Loading units…</p>;
  }

  const tops = topUnits(units);

  return (
    <div className="space-y-2">
      {tops.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tops.map((top) => (
            <SelectableChip
              key={top.id}
              label={top.name}
              selected={selected.includes(top.id)}
              disabled={disabled}
              onToggle={() => toggle(top.id)}
            />
          ))}
        </div>
      )}

      {/* Inline create — the empty-state primary path, and an "+ add" for
          courses that already have units. */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void createUnit();
            }
          }}
          disabled={disabled || creating}
          placeholder={tops.length === 0 ? "Name your first unit (e.g. Algebra)" : "New unit…"}
          className="min-w-0 flex-1 rounded-[--radius-sm] border border-border-light bg-surface px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void createUnit()}
          disabled={disabled || creating || !newName.trim()}
          className="shrink-0 rounded-[--radius-sm] border border-primary/40 px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary-bg disabled:opacity-40"
        >
          {creating ? "Adding…" : "Add unit"}
        </button>
      </div>
      {error && units !== null && (
        <p className="text-xs text-[color:var(--color-error)]">{error}</p>
      )}
    </div>
  );
}
