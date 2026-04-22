"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { BankItem, TeacherUnit } from "@/lib/api";
import { formatRelativeDate } from "@/lib/utils";
import { MathText } from "@/components/shared/math-text";
import { DIFFICULTY_STYLE } from "./constants";

const STATUS_CHIP: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  approved: "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  rejected: "bg-gray-100 text-gray-500 dark:bg-gray-500/15",
  archived: "bg-gray-100 text-gray-500 dark:bg-gray-500/15",
};

const SOURCE_LABEL: Record<string, string> = {
  generated: "generated",
  imported: "uploaded",
  practice: "practice",
};

interface QuestionRowProps {
  item: BankItem;
  units: TeacherUnit[];
  /** Action node rendered on the right of the meta line. Usually a button
   *  or hover-revealed icon set. Pass null to omit. */
  action?: ReactNode;
  /** Click handler for the row body — typically opens the WorkshopModal. */
  onClick: (item: BankItem) => void;
  /** Optional secondary line below the row — used to nest practice
   *  problem info under approved primary questions. */
  trailing?: ReactNode;
  /** Subtle visual emphasis for items that need attention (e.g. pending). */
  emphasis?: "pending" | "approved" | "rejected" | "none";
}

/**
 * Atomic question row. One shape, used everywhere bank items appear.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Title                                          [STATUS] │
 *   │  Question snippet (one or two muted lines)               │
 *   │  [unit] [difficulty] [source] · 3 days ago     [ACTION] │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Trailing children render below the meta line — used for nesting
 * practice problems under their parent on the Approved tab.
 */
export function QuestionRow({
  item,
  units,
  action,
  onClick,
  trailing,
  emphasis = "none",
}: QuestionRowProps) {
  const unitName = unitLabel(item.unit_id, units);
  const difficulty = DIFFICULTY_STYLE[item.difficulty];
  const sourceLabel = SOURCE_LABEL[item.source] ?? item.source;
  const date = formatRelativeDate(item.created_at);

  const emphasisBorder =
    emphasis === "pending"
      ? "border-l-2 border-l-amber-400"
      : emphasis === "approved"
        ? "border-l-2 border-l-green-400"
        : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`group rounded-[--radius-md] border border-border-light bg-surface transition-all hover:border-primary/40 hover:shadow-sm ${emphasisBorder}`}
    >
      <button
        type="button"
        onClick={() => onClick(item)}
        className="block w-full cursor-pointer px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1"
      >
        {/* Title row */}
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-1 min-w-0 flex-1 text-sm font-semibold text-text-primary group-hover:text-primary">
            {item.title || "(untitled)"}
          </h3>
          <span
            className={`shrink-0 rounded-[--radius-pill] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
              STATUS_CHIP[item.status] ?? STATUS_CHIP.archived
            }`}
          >
            {item.status}
          </span>
        </div>

        {/* Question snippet */}
        <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">
          <MathText text={item.question} />
        </div>

        {/* Meta + action row */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
          <Chip icon="📁" label={unitName} />
          {difficulty && <Chip className={difficulty.cls} label={difficulty.label} />}
          <Chip label={sourceLabel} muted />
          {date && <span className="text-text-muted/80">· {date}</span>}
          {action && <span className="ml-auto flex items-center gap-1">{action}</span>}
        </div>
      </button>

      {/* Trailing slot — nested practice problems etc. */}
      {trailing && (
        <div className="border-t border-border-light/60 px-4 py-2">{trailing}</div>
      )}
    </motion.div>
  );
}

function Chip({
  label,
  className,
  icon,
  muted,
}: {
  label: string;
  className?: string;
  icon?: string;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-semibold ${
        className ?? (muted ? "bg-bg-subtle text-text-muted" : "bg-primary-bg/40 text-primary")
      }`}
    >
      {icon && <span className="text-[9px]">{icon}</span>}
      {label}
    </span>
  );
}

function unitLabel(unitId: string | null, units: TeacherUnit[]): string {
  if (!unitId) return "Uncategorized";
  const top = units.find((u) => u.id === unitId);
  if (!top) return "Unknown";
  if (!top.parent_id) return top.name;
  const parent = units.find((u) => u.id === top.parent_id);
  return parent ? `${parent.name} / ${top.name}` : top.name;
}

