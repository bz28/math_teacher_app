"use client";

import { useMemo, useState } from "react";
import type { BankItem, TeacherUnit } from "@/lib/api";
import { unitLabel as labelForUnit, topUnitIdOf, topUnits } from "@/lib/units";
import { MathText } from "@/components/shared/math-text";
import { DIFFICULTY_STYLE } from "./constants";
import { buildTree, type TreeNode } from "./tree";

// ── Types ──

type VarFilter = "all" | "needs_vars" | "no_vars";
type DifficultyFilter = "all" | "easy" | "medium" | "hard";
type AssignmentFilter = "all" | "assigned" | "unassigned";
type SortKey = "newest" | "oldest" | "unit" | "difficulty";

const HEALTHY_THRESHOLD = 3;

const DIFF_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

// ── Component ──

export function ApprovedTable({
  items,
  units,
  onOpenItem,
  onOpenHomework,
}: {
  items: BankItem[];
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
  onOpenHomework: (id: string) => void;
}) {
  // Filter state
  const [varFilter, setVarFilter] = useState<VarFilter>("all");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [diffFilter, setDiffFilter] = useState<DifficultyFilter>("all");
  const [assignFilter, setAssignFilter] = useState<AssignmentFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  // Build tree to get parent→children mapping, then filter to parents
  const tree = useMemo(() => buildTree(items), [items]);

  // Compute approved variation counts per parent
  const varCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of tree) {
      const approvedCount = node.children.filter(
        (c) => c.status === "approved",
      ).length;
      map.set(node.item.id, approvedCount);
    }
    return map;
  }, [tree]);

  // Counts for quick-filter badges
  const { allCount, needsVarsCount, noVarsCount } = useMemo(() => {
    let needs = 0;
    let none = 0;
    for (const node of tree) {
      const count = varCountMap.get(node.item.id) ?? 0;
      if (count === 0) none++;
      else if (count < HEALTHY_THRESHOLD) needs++;
    }
    return { allCount: tree.length, needsVarsCount: needs, noVarsCount: none };
  }, [tree, varCountMap]);

  // Apply filters + sort
  const filtered = useMemo(() => {
    let nodes = tree;

    // Variation quick filter
    if (varFilter === "needs_vars") {
      nodes = nodes.filter((n) => {
        const c = varCountMap.get(n.item.id) ?? 0;
        return c > 0 && c < HEALTHY_THRESHOLD;
      });
    } else if (varFilter === "no_vars") {
      nodes = nodes.filter((n) => (varCountMap.get(n.item.id) ?? 0) === 0);
    }

    // Unit dropdown
    if (unitFilter !== "all") {
      nodes = nodes.filter(
        (n) => topUnitIdOf(units, n.item.unit_id) === unitFilter,
      );
    }

    // Difficulty dropdown
    if (diffFilter !== "all") {
      nodes = nodes.filter((n) => n.item.difficulty === diffFilter);
    }

    // Assignment dropdown
    if (assignFilter === "assigned") {
      nodes = nodes.filter((n) => n.item.used_in.length > 0);
    } else if (assignFilter === "unassigned") {
      nodes = nodes.filter((n) => n.item.used_in.length === 0);
    }

    // Sort
    const sorted = [...nodes];
    switch (sortKey) {
      case "newest":
        sorted.sort(
          (a, b) =>
            new Date(b.item.created_at).getTime() -
            new Date(a.item.created_at).getTime(),
        );
        break;
      case "oldest":
        sorted.sort(
          (a, b) =>
            new Date(a.item.created_at).getTime() -
            new Date(b.item.created_at).getTime(),
        );
        break;
      case "unit":
        sorted.sort((a, b) =>
          labelForUnit(units, a.item.unit_id).localeCompare(
            labelForUnit(units, b.item.unit_id),
          ),
        );
        break;
      case "difficulty":
        sorted.sort(
          (a, b) =>
            (DIFF_ORDER[a.item.difficulty] ?? 1) -
            (DIFF_ORDER[b.item.difficulty] ?? 1),
        );
        break;
    }
    return sorted;
  }, [tree, varFilter, unitFilter, diffFilter, assignFilter, sortKey, units, varCountMap]);

  const tops = topUnits(units);

  return (
    <div className="space-y-4">
      {/* Quick filter buttons */}
      <div className="flex flex-wrap gap-2">
        <QuickFilterBtn
          active={varFilter === "all"}
          onClick={() => setVarFilter("all")}
          label={`All (${allCount})`}
        />
        <QuickFilterBtn
          active={varFilter === "needs_vars"}
          onClick={() => setVarFilter("needs_vars")}
          label={`Needs Vars (${needsVarsCount})`}
          warn
        />
        <QuickFilterBtn
          active={varFilter === "no_vars"}
          onClick={() => setVarFilter("no_vars")}
          label={`No Vars (${noVarsCount})`}
          danger
        />
      </div>

      {/* Dropdown filters */}
      <div className="flex flex-wrap gap-2">
        <FilterSelect
          label="Unit"
          value={unitFilter}
          onChange={setUnitFilter}
          options={[
            { value: "all", label: "All units" },
            ...tops.map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
        <FilterSelect
          label="Difficulty"
          value={diffFilter}
          onChange={(v) => setDiffFilter(v as DifficultyFilter)}
          options={[
            { value: "all", label: "All" },
            { value: "easy", label: "Easy" },
            { value: "medium", label: "Medium" },
            { value: "hard", label: "Hard" },
          ]}
        />
        <FilterSelect
          label="Assignment"
          value={assignFilter}
          onChange={(v) => setAssignFilter(v as AssignmentFilter)}
          options={[
            { value: "all", label: "All" },
            { value: "assigned", label: "Assigned" },
            { value: "unassigned", label: "Unassigned" },
          ]}
        />
        <FilterSelect
          label="Sort by"
          value={sortKey}
          onChange={(v) => setSortKey(v as SortKey)}
          options={[
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
            { value: "unit", label: "Unit" },
            { value: "difficulty", label: "Difficulty" },
          ]}
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-[--radius-md] border border-dashed border-border-light px-4 py-12 text-center text-sm italic text-text-muted">
          No questions match these filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[--radius-lg] border border-border-light bg-surface">
          {/* Header row — hidden on mobile */}
          <div className="hidden border-b border-border-light bg-bg-subtle px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted sm:flex sm:items-center sm:gap-3">
            <div className="min-w-0 flex-1">Question</div>
            <div className="w-[120px] shrink-0">Unit</div>
            <div className="w-[80px] shrink-0">Difficulty</div>
            <div className="w-[150px] shrink-0">Used In</div>
            <div className="w-[80px] shrink-0 text-right">Variations</div>
          </div>
          <div className="divide-y divide-border-light/60">
            {filtered.map((node) => (
              <TableRow
                key={node.item.id}
                node={node}
                units={units}
                varCount={varCountMap.get(node.item.id) ?? 0}
                onOpenItem={onOpenItem}
                onOpenHomework={onOpenHomework}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Table Row ──

function TableRow({
  node,
  units,
  varCount,
  onOpenItem,
  onOpenHomework,
}: {
  node: TreeNode;
  units: TeacherUnit[];
  varCount: number;
  onOpenItem: (item: BankItem) => void;
  onOpenHomework: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const item = node.item;
  const unitName = labelForUnit(units, item.unit_id);
  const diffStyle = DIFFICULTY_STYLE[item.difficulty];

  return (
    <div>
      {/* Collapsed row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-bg-subtle"
      >
        <span className="shrink-0 text-xs text-text-muted">
          {expanded ? "▾" : "▸"}
        </span>
        {/* Question — truncated */}
        <div className="min-w-0 flex-1 truncate text-text-primary">
          {item.title || item.question.slice(0, 80)}
        </div>
        {/* Unit */}
        <div className="hidden w-[120px] shrink-0 truncate text-xs text-text-muted sm:block">
          {unitName}
        </div>
        {/* Difficulty pill */}
        <div className="hidden w-[80px] shrink-0 sm:block">
          {diffStyle && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${diffStyle.cls}`}
            >
              {diffStyle.label}
            </span>
          )}
        </div>
        {/* Used In pills */}
        <div className="hidden w-[150px] shrink-0 sm:flex sm:flex-wrap sm:gap-1">
          {item.used_in.length === 0 ? (
            <span className="text-[10px] italic text-text-muted">none</span>
          ) : (
            item.used_in.slice(0, 2).map((u) => (
              <span
                key={u.id}
                className="rounded-[--radius-pill] bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-500/20 dark:text-blue-300"
              >
                {u.title}
              </span>
            ))
          )}
          {item.used_in.length > 2 && (
            <span className="text-[10px] text-text-muted">
              +{item.used_in.length - 2}
            </span>
          )}
        </div>
        {/* Variation count + health */}
        <div className="w-[80px] shrink-0 text-right">
          <VariationBadge count={varCount} />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <ExpandedDetail
          node={node}
          units={units}
          onOpenItem={onOpenItem}
          onOpenHomework={onOpenHomework}
        />
      )}
    </div>
  );
}

// ── Expanded Detail ──

function ExpandedDetail({
  node,
  units,
  onOpenItem,
  onOpenHomework,
}: {
  node: TreeNode;
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
  onOpenHomework: (id: string) => void;
}) {
  const item = node.item;
  const approvedChildren = node.children.filter(
    (c) => c.status === "approved",
  );

  return (
    <div className="border-t border-border-light bg-bg-base/50 px-6 py-4 space-y-4">
      {/* Full question */}
      <div>
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Question
        </div>
        <div className="text-sm leading-relaxed text-text-primary">
          <MathText text={item.question} />
        </div>
      </div>

      {/* Solution steps */}
      {item.solution_steps && item.solution_steps.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Solution Steps
          </div>
          <ol className="list-inside list-decimal space-y-1 text-sm text-text-secondary">
            {item.solution_steps.map((step, i) => (
              <li key={i}>
                {step.title && (
                  <span className="font-semibold">{step.title}: </span>
                )}
                <MathText text={step.description} />
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Final answer */}
      {item.final_answer && (
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Final Answer
          </div>
          <div className="text-sm font-semibold text-text-primary">
            <MathText text={item.final_answer} />
          </div>
        </div>
      )}

      {/* Variations list */}
      <div>
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Approved Variations ({approvedChildren.length})
        </div>
        {approvedChildren.length === 0 ? (
          <p className="text-xs italic text-text-muted">
            No approved variations yet.
          </p>
        ) : (
          <div className="space-y-1.5 border-l-2 border-purple-200 pl-3 dark:border-purple-500/30">
            {approvedChildren.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => onOpenItem(child)}
                className="block w-full rounded-[--radius-sm] border border-border-light/60 bg-surface px-3 py-2 text-left hover:border-primary/40 hover:bg-bg-subtle"
              >
                <div className="line-clamp-2 text-[13px] leading-snug text-text-primary">
                  <MathText text={child.question} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onOpenItem(item)}
          className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-subtle hover:text-text-primary"
        >
          Edit
        </button>
        {item.used_in
          .filter((u) => u.type === "homework")
          .map((hw) => (
            <button
              key={hw.id}
              type="button"
              onClick={() => onOpenHomework(hw.id)}
              className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/10"
            >
              Open {hw.title} ↗
            </button>
          ))}
      </div>
    </div>
  );
}

// ── Shared pieces ──

function VariationBadge({ count }: { count: number }) {
  if (count >= HEALTHY_THRESHOLD) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700 dark:text-green-400">
        {count} <span className="text-green-600">&#10003;</span>
      </span>
    );
  }
  if (count > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-400">
        {count} <span>&#9888;&#65039;</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 dark:text-red-400">
      0 <span>&#128308;</span>
    </span>
  );
}

function QuickFilterBtn({
  active,
  onClick,
  label,
  warn,
  danger,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  warn?: boolean;
  danger?: boolean;
}) {
  let cls: string;
  if (active) {
    cls = "bg-primary text-white";
  } else if (danger) {
    cls =
      "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10";
  } else if (warn) {
    cls =
      "border border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-400 dark:hover:bg-amber-500/10";
  } else {
    cls =
      "border border-border-light text-text-secondary hover:bg-bg-subtle";
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[--radius-pill] px-3 py-1 text-xs font-semibold transition-colors ${cls}`}
    >
      {label}
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-text-muted">
      <span className="font-semibold">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[--radius-md] border border-border-light bg-surface px-2 py-1 text-xs text-text-primary focus:border-primary focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
