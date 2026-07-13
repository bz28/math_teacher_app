"use client";

import { useState } from "react";
import type { TeacherAssignment, TeacherUnit } from "@/lib/api";
import { unitLabel as labelForUnit } from "@/lib/units";
import { HomeworkCard, type HomeworkBucket } from "./homework-card";
import type { BucketedHomeworks } from "./homework-buckets";

export type { BucketedHomeworks };

const SECTION_CONFIG: {
  key: keyof BucketedHomeworks;
  label: string;
  headerClass: string;
  countClass: string;
}[] = [
  {
    key: "needsGrading",
    label: "NEEDS GRADING",
    headerClass: "text-[color:var(--color-error)]",
    countClass: "bg-[color:var(--color-error-light)] text-[color:var(--color-error)]",
  },
  {
    key: "dueThisWeek",
    label: "DUE THIS WEEK",
    headerClass: "text-[color:var(--color-info)]",
    countClass: "bg-[color:var(--color-info-light)] text-[color:var(--color-info)]",
  },
  {
    key: "upcoming",
    label: "UPCOMING",
    headerClass: "text-text-muted",
    countClass: "bg-bg-subtle text-text-muted",
  },
  {
    key: "completed",
    label: "COMPLETED",
    headerClass: "text-text-muted",
    countClass: "bg-bg-subtle text-text-muted",
  },
];

/**
 * Renders time-bucketed homework sections. Empty sections are hidden.
 * COMPLETED is collapsed by default unless it's the only section with items.
 */
export function HomeworkTimeline({
  buckets,
  units,
  onOpen,
}: {
  buckets: BucketedHomeworks;
  units: TeacherUnit[];
  onOpen: (id: string) => void;
}) {
  const nonCompletedCount =
    buckets.needsGrading.length +
    buckets.dueThisWeek.length +
    buckets.upcoming.length;
  const onlyCompleted = nonCompletedCount === 0 && buckets.completed.length > 0;

  return (
    <div className="space-y-8">
      {SECTION_CONFIG.map((cfg) => {
        const items = buckets[cfg.key];
        if (items.length === 0) return null;
        return (
          <BucketSection
            key={cfg.key}
            bucket={cfg.key}
            label={cfg.label}
            headerClass={cfg.headerClass}
            countClass={cfg.countClass}
            items={items}
            units={units}
            onOpen={onOpen}
            defaultCollapsed={cfg.key === "completed" && !onlyCompleted}
          />
        );
      })}
    </div>
  );
}

function BucketSection({
  bucket,
  label,
  headerClass,
  countClass,
  items,
  units,
  onOpen,
  defaultCollapsed,
}: {
  bucket: keyof BucketedHomeworks;
  label: string;
  headerClass: string;
  countClass: string;
  items: TeacherAssignment[];
  units: TeacherUnit[];
  onOpen: (id: string) => void;
  defaultCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section>
      {/* Section header */}
      <div className="mb-3 flex items-center gap-2 border-b border-border-light pb-2">
        <h3 className={`text-[11px] font-bold tracking-wider ${headerClass}`}>
          {label}
        </h3>
        <span
          className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${countClass}`}
        >
          {items.length}
        </span>
        {defaultCollapsed && (
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="ml-auto text-[11px] font-medium text-primary hover:underline"
          >
            {collapsed ? "Show all \u2192" : "Hide"}
          </button>
        )}
      </div>

      {/* Cards */}
      {!collapsed && (
        <div className={bucket === "completed" ? "space-y-0" : "space-y-3"}>
          {items.map((hw) => (
            <HomeworkCard
              key={hw.id}
              hw={hw}
              bucket={bucket as HomeworkBucket}
              unitLabel={resolveUnitLabel(hw, units)}
              needsVariationsCount={null}
              onOpen={() => onOpen(hw.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Resolve the first unit_id to a label. Empty array isn't reachable
 *  for new HWs (the application layer requires ≥1 unit) — the empty
 *  string fallback only protects against any pre-existing rows that
 *  somehow escaped that invariant. */
function resolveUnitLabel(hw: TeacherAssignment, units: TeacherUnit[]): string {
  if (hw.unit_ids.length === 0) return "";
  return labelForUnit(units, hw.unit_ids[0]);
}
