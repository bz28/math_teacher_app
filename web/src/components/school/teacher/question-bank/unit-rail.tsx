"use client";

import type { BankItem, TeacherUnit } from "@/lib/api";
import { subfoldersOf, topUnits } from "@/lib/units";

// Selection model for the rail. "all" = no filter; "uncategorized" =
// items with no unit; otherwise a unit id.
export type UnitSelection = "all" | "uncategorized" | string;

interface UnitRailProps {
  units: TeacherUnit[];
  items: BankItem[];
  selected: UnitSelection;
  onSelect: (selection: UnitSelection) => void;
}

// Sidebar that lets the teacher pick which unit to view. Mirrors the
// materials FolderTree visual language (rounded card, indented sub-units,
// counts on the right) but is read-only — unit creation/rename/delete
// lives in the materials tab. Counts come from the locally loaded items
// for the current status filter, so they update instantly when the
// teacher flips between Pending/Approved/Rejected.
export function UnitRail({ units, items, selected, onSelect }: UnitRailProps) {
  const tops = topUnits(units);

  const countFor = (uid: string | null) =>
    items.filter((i) => i.unit_id === uid).length;
  const totalCount = items.length;
  const uncategorizedCount = countFor(null);

  return (
    <div className="rounded-[--radius-lg] border border-border-light bg-surface p-3 shadow-sm">
      <RailRow
        label="All units"
        icon="📚"
        count={totalCount}
        active={selected === "all"}
        onSelect={() => onSelect("all")}
      />
      <RailRow
        label="Uncategorized"
        icon="📂"
        count={uncategorizedCount}
        active={selected === "uncategorized"}
        muted
        onSelect={() => onSelect("uncategorized")}
      />

      <div className="my-2 h-px bg-border-light" />

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
                icon="📁"
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
                        icon="📁"
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
  icon,
  count,
  active,
  muted,
  isSub,
  onSelect,
}: {
  label: string;
  icon: string;
  count: number;
  active: boolean;
  muted?: boolean;
  isSub?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-[--radius-md] px-2 py-1.5 text-left text-xs transition-colors ${
        active
          ? "bg-primary/10 font-bold text-primary"
          : muted
            ? "text-text-muted hover:bg-bg-subtle"
            : "text-text-secondary hover:bg-bg-subtle hover:text-text-primary"
      } ${isSub ? "text-[11px]" : ""}`}
    >
      <span aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1 truncate font-semibold">{label}</span>
      {count > 0 && (
        <span
          className={`shrink-0 rounded-[--radius-pill] px-1.5 text-[10px] font-bold ${
            active
              ? "bg-primary text-white"
              : "bg-bg-subtle text-text-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
