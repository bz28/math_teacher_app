"use client";

import { useMemo, useState } from "react";
import type { BankItem, TeacherUnit } from "@/lib/api";
import { unitLabel as labelForUnit } from "@/lib/units";
import { BankRow } from "./bank-row";
import { buildTree, type TreeNode } from "./tree";

// Approved view, folder edition. Replaces the old Available / In a
// homework or test split with the proper folder structure agreed in
// plans/question-bank-redesign-v2.md:
//
//   📁 Unit
//     └─ 📝 Homework
//         └─ HW #1
//             ├─ Q1 🔒  ✨ N variations
//             └─ Q2 🔒  ⚠️ 0 variations
//     └─ 📂 Unattached  (approved primaries not yet in any homework)
//
// Tests / mock exam are deferred to a later phase.
//
// All grouping is computed client-side from the items prop and each
// item's used_in array — there's no server-side join needed because
// the bank list endpoint already hydrates used_in.
export function ApprovedUnitFolder({
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
  const [unitOpen, setUnitOpen] = useState(true);
  const [homeworkOpen, setHomeworkOpen] = useState(true);
  const [unattachedOpen, setUnattachedOpen] = useState(false);

  // Group root nodes by HW. A primary that lives in multiple homeworks
  // (rare but possible — same question on two HWs) appears under each.
  // Variations are pulled along as children of the primary.
  const { hwGroups, unattached } = useMemo(() => {
    const tree = buildTree(items);
    const hwMap = new Map<
      string,
      { id: string; title: string; status: string; nodes: TreeNode[] }
    >();
    const unattached: TreeNode[] = [];
    for (const node of tree) {
      const homeworkRefs = node.item.used_in.filter(
        (u) => u.type === "homework",
      );
      if (homeworkRefs.length === 0) {
        unattached.push(node);
        continue;
      }
      for (const hw of homeworkRefs) {
        const existing = hwMap.get(hw.id);
        if (existing) {
          existing.nodes.push(node);
        } else {
          hwMap.set(hw.id, {
            id: hw.id,
            title: hw.title,
            status: hw.status,
            nodes: [node],
          });
        }
      }
    }
    return {
      hwGroups: Array.from(hwMap.values()).sort((a, b) =>
        a.title.localeCompare(b.title),
      ),
      unattached,
    };
  }, [items]);

  const totalCount = items.length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setUnitOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-border-light pb-1 text-left text-xs font-bold uppercase tracking-wider text-text-muted hover:text-text-primary"
      >
        <span>{unitOpen ? "▾" : "▸"}</span>
        <span>📁 {label}</span>
        <span className="font-normal normal-case text-text-muted/80">
          · {totalCount} {totalCount === 1 ? "question" : "questions"}
        </span>
      </button>

      {unitOpen && (
        <div className="mt-3 space-y-3">
          {/* Homework folder — only if any HWs reference questions in
              this unit. */}
          {hwGroups.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setHomeworkOpen((v) => !v)}
                className="flex w-full items-center gap-2 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted hover:text-text-primary"
              >
                <span>{homeworkOpen ? "▾" : "▸"}</span>
                <span>📝 Homework</span>
                <span className="font-normal normal-case text-text-muted/80">
                  · {hwGroups.length}
                </span>
              </button>
              {homeworkOpen && (
                <div className="mt-2 space-y-3">
                  {hwGroups.map((hw) => (
                    <HomeworkFolder
                      key={hw.id}
                      hw={hw}
                      units={units}
                      onOpenItem={onOpenItem}
                      onOpenHomework={onOpenHomework}
                      onChanged={onChanged}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Unattached primaries — approved but not in any HW yet.
              Should be rare under the new flow but happens for legacy
              data or after a HW gets deleted. */}
          {unattached.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setUnattachedOpen((v) => !v)}
                className="flex w-full items-center gap-2 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted hover:text-text-primary"
              >
                <span>{unattachedOpen ? "▾" : "▸"}</span>
                <span>📂 Unattached</span>
                <span className="font-normal normal-case text-text-muted/80">
                  · {unattached.length}
                </span>
              </button>
              {unattachedOpen && (
                <div className="mt-2 divide-y divide-border-light/60 rounded-[--radius-md] border border-border-light bg-surface">
                  {unattached.map((node) => (
                    <PrimaryWithVariations
                      key={node.item.id}
                      node={node}
                      units={units}
                      onOpenItem={onOpenItem}
                      onOpenHomework={onOpenHomework}
                      onChanged={onChanged}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {hwGroups.length === 0 && unattached.length === 0 && (
            <div className="rounded-[--radius-md] border border-dashed border-border-light px-3 py-6 text-center text-xs italic text-text-muted">
              No approved questions in this unit yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HomeworkFolder({
  hw,
  units,
  onOpenItem,
  onOpenHomework,
  onChanged,
}: {
  hw: { id: string; title: string; status: string; nodes: TreeNode[] };
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(true);
  const isPublished = hw.status === "published";
  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-semibold text-text-secondary hover:text-text-primary"
        >
          <span>{open ? "▾" : "▸"}</span>
          <span className="truncate">📂 {hw.title}</span>
          <span
            className={`shrink-0 rounded-[--radius-pill] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
              isPublished
                ? "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300"
                : "border border-dashed border-text-muted/40 text-text-muted"
            }`}
          >
            {isPublished ? "published" : "draft"}
          </span>
          <span className="shrink-0 text-text-muted/70">· {hw.nodes.length}</span>
        </button>
        <button
          type="button"
          onClick={() => onOpenHomework(hw.id)}
          className="shrink-0 rounded p-1 text-[10px] font-semibold text-text-muted hover:bg-bg-subtle hover:text-text-primary"
          title="Open homework"
        >
          Open ↗
        </button>
      </div>
      {open && (
        <div className="ml-4 mt-1 divide-y divide-border-light/60 rounded-[--radius-md] border border-border-light bg-surface">
          {hw.nodes.map((node) => (
            <PrimaryWithVariations
              key={node.item.id}
              node={node}
              units={units}
              onOpenItem={onOpenItem}
              onOpenHomework={onOpenHomework}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One primary problem row + an inline expander for its practice
// variations. The variation badge is the standout new visual: green
// when there are variations, amber ⚠️ when there are zero (signals
// the teacher to generate some).
function PrimaryWithVariations({
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
  const approvedChildren = node.children.filter((c) => c.status === "approved").length;
  const pendingChildren = node.children.filter((c) => c.status === "pending").length;
  const hasVariations = childrenCount > 0;

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
      <div className="ml-7 mb-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => hasVariations && setVariationsOpen((v) => !v)}
          disabled={!hasVariations}
          className={`flex items-center gap-1 rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold ${
            hasVariations
              ? "bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-500/20 dark:text-purple-300"
              : "border border-dashed border-amber-400 text-amber-700 dark:border-amber-500/40 dark:text-amber-400"
          }`}
        >
          {hasVariations ? (
            <>
              {variationsOpen ? "▾" : "▸"} ✨ {approvedChildren} variation
              {approvedChildren === 1 ? "" : "s"}
              {pendingChildren > 0 && ` · ${pendingChildren} pending`}
            </>
          ) : (
            <>⚠️ 0 practice variations</>
          )}
        </button>
        {!hasVariations && (
          <button
            type="button"
            onClick={() => onOpenItem(node.item)}
            className="rounded-[--radius-pill] border border-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-400 dark:hover:bg-amber-500/10"
            title="Open the question to generate similar variations"
          >
            Generate →
          </button>
        )}
      </div>
      {hasVariations && variationsOpen && (
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
    </div>
  );
}
