"use client";

import type { TeacherUnit } from "@/lib/api";
import { subfoldersOf, topUnits } from "@/lib/units";
import { FolderIcon, FolderOpenIcon } from "@/components/ui/icons";

// Selection model for the rail. "all" = no filter; "uncategorized" =
// items with no unit; otherwise a unit id.
export type UnitSelection = "all" | "uncategorized" | string;

interface UnitRailProps {
  units: TeacherUnit[];
  selected: UnitSelection;
  onSelect: (selection: UnitSelection) => void;
  /** Compute the count for a given unit (or null for uncategorized).
   *  Caller-provided so the rail works for both bank items (single
   *  unit_id) and assignments (unit_ids array). */
  countFor: (unitId: string | null) => number;
  totalCount: number;
}

// Filter-by-unit sidebar shared by Question Bank and Homework tabs.
// Mirrors the materials FolderTree visual language: rounded rows,
// purple accent on the selected row, count pill on the right. Read-
// only — unit creation/rename/delete lives in the materials tab.
export function UnitRail({
  units,
  selected,
  onSelect,
  countFor,
  totalCount,
}: UnitRailProps) {
  const tops = topUnits(units);
  const uncategorizedCount = countFor(null);

  return (
    <div>
      <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-text-muted">
        Filter by unit
      </div>
      <RailRow
        label="All units"
        count={totalCount}
        active={selected === "all"}
        onSelect={() => onSelect("all")}
      />
      <RailRow
        label="Uncategorized"
        count={uncategorizedCount}
        active={selected === "uncategorized"}
        onSelect={() => onSelect("uncategorized")}
      />

      <div className="my-2 h-px bg-border-light/60" />

      {tops.length === 0 && (
        <p className="px-2 py-2 text-xs text-text-muted">No units yet.</p>
      )}
      <ul className="space-y-0.5">
        {tops.map((u) => {
          const subs = subfoldersOf(units, u.id);
          return (
            <li key={u.id}>
              <RailRow
                label={u.name}
                count={countFor(u.id)}
                active={selected === u.id}
                onSelect={() => onSelect(u.id)}
              />
              {subs.length > 0 && (
                <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-border-light pl-2">
                  {subs.map((sub) => (
                    <li key={sub.id}>
                      <RailRow
                        label={sub.name}
                        count={countFor(sub.id)}
                        active={selected === sub.id}
                        isSub
                        onSelect={() => onSelect(sub.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RailRow({
  label,
  count,
  active,
  isSub,
  onSelect,
}: {
  label: string;
  count: number;
  active: boolean;
  isSub?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group/row relative flex w-full items-center gap-2 rounded-[--radius-sm] px-2 py-2 text-left text-sm transition-colors duration-150 ease-out focus-visible:outline-none ${
        active
          ? "bg-primary-bg font-semibold text-primary"
          : "text-text-secondary hover:bg-bg-subtle"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-primary"
        />
      )}
      {active && !isSub ? (
        <FolderOpenIcon className="h-4 w-4 shrink-0 text-primary" />
      ) : (
        <FolderIcon
          className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-text-muted"}`}
        />
      )}
      <span className={`min-w-0 flex-1 truncate ${isSub ? "text-[13px]" : ""}`}>{label}</span>
      <span
        className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
          active
            ? "bg-primary text-white"
            : "bg-bg-subtle text-text-muted group-hover/row:bg-surface"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
