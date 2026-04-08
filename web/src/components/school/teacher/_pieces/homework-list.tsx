"use client";

import { useMemo, useState } from "react";
import type { TeacherAssignment, TeacherUnit } from "@/lib/api";
import { unitLabel as labelForUnit } from "@/lib/units";
import { FolderIcon, FolderOpenIcon } from "@/components/ui/icons";
import { HomeworkCard } from "./homework-card";

// Unit-grouped homework list. Mirrors ApprovedView from the question
// bank tab so the two surfaces feel like siblings:
//
//   📁 Math
//      📝 hw 1: Linear equations  [draft]   Open ↗
//      📝 hw 2: Quadratics         [draft]
//   📁 Chemistry
//      📝 hw 3: Reactions  [published]
//
// Multi-unit HWs (midterms) appear under each declared unit. A HW
// with no unit_ids (shouldn't happen with the new required-unit
// validation, but defensive) lands in a "No unit" bucket.
//
// Within each unit, HWs are sorted by due-date-asc with no-date last,
// then alphabetical by title as the tiebreaker. Most-urgent first.
export function HomeworkList({
  homeworks,
  units,
  onOpen,
}: {
  homeworks: TeacherAssignment[];
  units: TeacherUnit[];
  onOpen: (id: string) => void;
}) {
  const groups = useMemo(() => {
    type Group = { id: string; label: string; hws: TeacherAssignment[] };
    const map = new Map<string, Group>();
    const noUnit: TeacherAssignment[] = [];

    for (const hw of homeworks) {
      if (hw.unit_ids.length === 0) {
        noUnit.push(hw);
        continue;
      }
      for (const uid of hw.unit_ids) {
        let g = map.get(uid);
        if (!g) {
          g = { id: uid, label: labelForUnit(units, uid), hws: [] };
          map.set(uid, g);
        }
        g.hws.push(hw);
      }
    }

    const out: Group[] = Array.from(map.values())
      .map((g) => ({ ...g, hws: g.hws.slice().sort(compareHwForList) }))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (noUnit.length > 0) {
      out.push({
        id: "__no_unit__",
        label: "No unit",
        hws: noUnit.slice().sort(compareHwForList),
      });
    }
    return out;
  }, [homeworks, units]);

  if (groups.length === 0) return null;

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <UnitSection key={g.id} label={g.label} hws={g.hws} onOpen={onOpen} />
      ))}
    </div>
  );
}

function UnitSection({
  label,
  hws,
  onOpen,
}: {
  label: string;
  hws: TeacherAssignment[];
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-3 flex w-full items-center gap-2 border-b border-border-light pb-2 text-left transition-colors hover:text-text-primary"
      >
        {open ? (
          <FolderOpenIcon className="h-4 w-4 shrink-0 text-primary" />
        ) : (
          <FolderIcon className="h-4 w-4 shrink-0 text-text-muted" />
        )}
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold uppercase tracking-wider text-text-secondary">
          {label}
        </h3>
        <span className="shrink-0 text-[11px] font-semibold text-text-muted">
          {hws.length} {hws.length === 1 ? "homework" : "homeworks"}
        </span>
        <span className="shrink-0 text-text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-3">
          {hws.map((hw) => (
            <HomeworkCard
              key={hw.id}
              hw={hw}
              needsVariationsCount={null}
              onOpen={() => onOpen(hw.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// Sort: due-date ascending, with null due dates last. Title is the
// tiebreaker so the order is deterministic and stable.
function compareHwForList(
  a: TeacherAssignment, b: TeacherAssignment,
): number {
  if (a.due_at && b.due_at) {
    const diff = new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    if (diff !== 0) return diff;
  } else if (a.due_at) {
    return -1;
  } else if (b.due_at) {
    return 1;
  }
  return a.title.localeCompare(b.title);
}
