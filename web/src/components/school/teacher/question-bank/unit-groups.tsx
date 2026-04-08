"use client";

import { useMemo, useState } from "react";
import type { BankItem, TeacherUnit } from "@/lib/api";
import { unitLabel as labelForUnit } from "@/lib/units";
import { BankRow } from "./bank-row";
import { buildTree, buildUnitGroups, type TreeNode } from "./tree";

// Approved view: collapsible unit split into two sections — "Available"
// (root questions not yet in any homework or test, default expanded)
// and "In a homework or test" (used roots, default collapsed). Practice
// variations nest under their parent in either section.
export function ApprovedUnitGroup({
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
  const [storageOpen, setStorageOpen] = useState(false);

  // Memoize the tree + available/in-use split — buildTree is O(n) and
  // this component re-renders on every parent reload + every poll tick.
  const { available, inUse } = useMemo(() => {
    const tree = buildTree(items);
    return {
      available: tree.filter((node) => node.item.used_in.length === 0),
      inUse: tree.filter((node) => node.item.used_in.length > 0),
    };
  }, [items]);

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
          · {available.length + inUse.length} {available.length + inUse.length === 1 ? "question" : "questions"}
          {available.length > 0 && ` · ${available.length} available`}
          {inUse.length > 0 && ` · ${inUse.length} in use`}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Available section — default expanded */}
          <BankSection
            title="Available"
            count={available.length}
            nodes={available}
            units={units}
            defaultOpen
            emptyText="All approved questions in this unit are in a homework or test 🎉"
            onOpenItem={onOpenItem}
            onOpenHomework={onOpenHomework}
            onChanged={onChanged}
          />

          {/* In-use section — default collapsed, hidden when empty */}
          {inUse.length > 0 && (
            <BankSection
              title="In a homework or test"
              count={inUse.length}
              nodes={inUse}
              units={units}
              defaultOpen={storageOpen}
              onToggle={setStorageOpen}
              onOpenItem={onOpenItem}
              onOpenHomework={onOpenHomework}
              onChanged={onChanged}
            />
          )}
        </div>
      )}
    </div>
  );
}

// One labeled section inside an Approved unit (Available or In-use).
// Renders a small header with count + caret, then the rows when open.
function BankSection({
  title,
  count,
  nodes,
  units,
  defaultOpen,
  onToggle,
  emptyText,
  onOpenItem,
  onOpenHomework,
  onChanged,
}: {
  title: string;
  count: number;
  nodes: TreeNode[];
  units: TeacherUnit[];
  defaultOpen: boolean;
  onToggle?: (open: boolean) => void;
  emptyText?: string;
  onOpenItem: (item: BankItem) => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    onToggle?.(next);
  };
  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted hover:text-text-primary"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{title}</span>
        <span className="font-normal normal-case text-text-muted/80">· {count}</span>
      </button>
      {open && (
        <div className="mt-1 divide-y divide-border-light/60 rounded-[--radius-md] border border-border-light bg-surface">
          {nodes.length === 0 && emptyText ? (
            <div className="px-3 py-6 text-center text-xs italic text-text-muted">
              {emptyText}
            </div>
          ) : (
            nodes.map((node) => (
              <BankRowWithChildren
                key={node.item.id}
                node={node}
                units={units}
                onOpenItem={onOpenItem}
                onOpenHomework={onOpenHomework}
                onChanged={onChanged}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// A root row with optional inline-expandable practice variations.
function BankRowWithChildren({
  node,
  units,
  onOpenItem,
  onOpenHomework,
  onChanged,
}: {
  node: TreeNode;
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const [variationsOpen, setVariationsOpen] = useState(false);
  const childrenCount = node.children.length;
  const pendingChildren = node.children.filter((c) => c.status === "pending").length;

  return (
    <div>
      <BankRow
        item={node.item}
        unitLabel={labelForUnit(units, node.item.unit_id)}
        showUnit={false}
        onOpen={() => onOpenItem(node.item)}
        onOpenHomework={onOpenHomework}
        onChanged={onChanged}
      />
      {childrenCount > 0 && (
        <>
          <button
            type="button"
            onClick={() => setVariationsOpen((v) => !v)}
            className="ml-7 mb-1 flex items-center gap-1 text-[11px] font-semibold text-purple-600 hover:underline dark:text-purple-400"
          >
            <span>{variationsOpen ? "▾" : "▸"}</span>
            <span>
              ✨ {childrenCount} practice variation{childrenCount === 1 ? "" : "s"}
              {pendingChildren > 0 && ` · ${pendingChildren} pending`}
            </span>
          </button>
          {variationsOpen && (
            <div className="ml-6 border-l border-border-light">
              {node.children.map((child) => (
                <BankRow
                  key={child.id}
                  item={child}
                  unitLabel={labelForUnit(units, child.unit_id)}
                  showUnit={false}
                  variation
                  onOpen={() => onOpenItem(child)}
                  onOpenHomework={onOpenHomework}
                  onChanged={onChanged}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Pending and Rejected views: same unit grouping as Approved, but no
// sub-sections. Just a flat dense list of rows per unit. Lets the
// teacher review/triage one topic at a time.
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
