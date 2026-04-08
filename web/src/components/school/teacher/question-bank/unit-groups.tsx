"use client";

import { useState } from "react";
import type { BankItem, TeacherUnit } from "@/lib/api";
import { unitLabel as labelForUnit } from "@/lib/units";
import { BankRow } from "./bank-row";
import { buildUnitGroups } from "./tree";

// Pending and Rejected views: flat list per unit. Folder grouping is
// the wrong shape for triage states — the teacher just wants to scan
// and act. The Approved view uses ApprovedUnitFolder instead.
export function SimpleUnitList({
  items,
  units,
  onOpenItem,
  onOpenHomework,
  onChanged,
}: {
  items: BankItem[];
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const groups = buildUnitGroups(items, units);
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <SimpleUnitGroup
          key={group.id}
          label={group.label}
          items={group.items}
          units={units}
          onOpenItem={onOpenItem}
          onOpenHomework={onOpenHomework}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function SimpleUnitGroup({
  label,
  items,
  units,
  onOpenItem,
  onOpenHomework,
  onChanged,
}: {
  label: string;
  items: BankItem[];
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-border-light pb-1 text-left text-xs font-bold uppercase tracking-wider text-text-muted hover:text-text-primary"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>📁 {label}</span>
        <span className="font-normal normal-case text-text-muted/80">
          · {items.length} {items.length === 1 ? "question" : "questions"}
        </span>
      </button>
      {open && (
        <div className="mt-2 divide-y divide-border-light/60 rounded-[--radius-md] border border-border-light bg-surface">
          {items.map((item) => (
            <BankRow
              key={item.id}
              item={item}
              unitLabel={labelForUnit(units, item.unit_id)}
              showUnit={false}
              onOpen={() => onOpenItem(item)}
              onOpenHomework={onOpenHomework}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}
