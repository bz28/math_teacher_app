"use client";

import { useMemo, useState } from "react";
import type { BankItem, TeacherUnit } from "@/lib/api";
import { unitLabel as labelForUnit } from "@/lib/units";
import { FolderIcon, FolderOpenIcon } from "@/components/ui/icons";
import { BankRow } from "./bank-row";
import { buildTree, type TreeNode } from "./tree";

// Approved view, folder edition. Renders the agreed structure:
//
//   📁 Unit
//     └─ 📝 Homework
//         └─ HW #1
//             ├─ Q1 🔒  ✨ N variations
//             └─ Q2 🔒  ⚠️ 0 practice variations
//     └─ 📂 Unattached  (rare; legacy or orphan questions)
//
// Visual language matches the materials tab — rounded surface card,
// purple accent on hover, generous spacing.
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

  const { hwGroups, inTestOrQuiz, unattached } = useMemo(() => {
    const tree = buildTree(items);
    const hwMap = new Map<
      string,
      { id: string; title: string; status: string; nodes: TreeNode[] }
    >();
    const inTestOrQuiz: TreeNode[] = [];
    const unattached: TreeNode[] = [];
    for (const node of tree) {
      const homeworkRefs = node.item.used_in.filter(
        (u) => u.type === "homework",
      );
      if (homeworkRefs.length > 0) {
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
        continue;
      }
      // Not in any homework. Distinguish "in a test/quiz only" (a real
      // attachment, just not the scope of this redesign) from truly
      // orphaned questions — labelling the former as "Unattached"
      // would mislead the teacher.
      if (node.item.used_in.length > 0) {
        inTestOrQuiz.push(node);
      } else {
        unattached.push(node);
      }
    }
    return {
      hwGroups: Array.from(hwMap.values()).sort((a, b) =>
        a.title.localeCompare(b.title),
      ),
      inTestOrQuiz,
      unattached,
    };
  }, [items]);

  // Total count for the unit header — count primaries only. A unit
  // with 1 primary and 5 approved variations has 1 *question*, not 6.
  const totalCount = items.filter((i) => !i.parent_question_id).length;

  return (
    <section className="rounded-[--radius-lg] border border-border-light bg-surface shadow-sm">
      {/* Unit header — large, clickable to collapse */}
      <button
        type="button"
        onClick={() => setUnitOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-subtle"
      >
        {unitOpen ? (
          <FolderOpenIcon className="h-5 w-5 shrink-0 text-primary" />
        ) : (
          <FolderIcon className="h-5 w-5 shrink-0 text-text-muted" />
        )}
        <h3 className="min-w-0 flex-1 truncate text-base font-bold text-text-primary">
          {label}
        </h3>
        <span className="shrink-0 rounded-full bg-bg-subtle px-2 py-0.5 text-[11px] font-bold text-text-muted">
          {totalCount} {totalCount === 1 ? "question" : "questions"}
        </span>
        <span className="shrink-0 text-text-muted">{unitOpen ? "▾" : "▸"}</span>
      </button>

      {unitOpen && (
        <div className="space-y-4 border-t border-border-light px-4 py-4">
          {hwGroups.map((hw) => (
            <HomeworkCard
              key={hw.id}
              hw={hw}
              units={units}
              onOpenItem={onOpenItem}
              onOpenHomework={onOpenHomework}
              onChanged={onChanged}
            />
          ))}

          {inTestOrQuiz.length > 0 && (
            <SecondarySection
              icon="📊"
              label="In a test or quiz"
              hint="not in any homework"
              nodes={inTestOrQuiz}
              units={units}
              onOpenItem={onOpenItem}
              onOpenHomework={onOpenHomework}
              onChanged={onChanged}
            />
          )}

          {unattached.length > 0 && (
            <SecondarySection
              icon="📂"
              label="Unattached"
              hint="not in any assignment"
              nodes={unattached}
              units={units}
              onOpenItem={onOpenItem}
              onOpenHomework={onOpenHomework}
              onChanged={onChanged}
            />
          )}

          {hwGroups.length === 0 && inTestOrQuiz.length === 0 && unattached.length === 0 && (
            <div className="rounded-[--radius-md] border border-dashed border-border-light px-3 py-8 text-center text-xs italic text-text-muted">
              No approved questions in this unit yet.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function HomeworkCard({
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

  // Variation health summary for the HW header — fast at-a-glance
  // signal of how much practice coverage this homework has.
  const totalProblems = hw.nodes.length;
  const problemsWithVariations = hw.nodes.filter((n) => n.children.length > 0).length;
  const needsAttention = problemsWithVariations < totalProblems;

  return (
    <div className="overflow-hidden rounded-[--radius-md] border border-border-light bg-bg-base">
      {/* HW header */}
      <div className="flex items-center gap-2 bg-bg-subtle/50 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-text-muted">{open ? "▾" : "▸"}</span>
          <span className="text-base">📝</span>
          <span className="min-w-0 truncate font-bold text-text-primary">
            {hw.title}
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
              isPublished
                ? "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300"
                : "border border-text-muted/40 text-text-muted"
            }`}
          >
            {isPublished ? "published" : "draft"}
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-text-muted">
            {totalProblems} {totalProblems === 1 ? "problem" : "problems"}
            {needsAttention && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                · ⚠️ {totalProblems - problemsWithVariations} need variations
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onOpenHomework(hw.id)}
          className="shrink-0 rounded-[--radius-sm] border border-border-light bg-surface px-2 py-1 text-[10px] font-bold text-text-secondary hover:bg-bg-subtle hover:text-text-primary"
          title="Open homework"
        >
          Open ↗
        </button>
      </div>

      {open && (
        <div className="divide-y divide-border-light/60">
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

// Generic non-HW section: holds primaries that are either in a test/
// quiz only (test scope is deferred) or truly orphaned. Same shape as
// HomeworkCard but without the draft/published pill or "Open ↗" link.
function SecondarySection({
  icon,
  label,
  hint,
  nodes,
  units,
  onOpenItem,
  onOpenHomework,
  onChanged,
}: {
  icon: string;
  label: string;
  hint: string;
  nodes: TreeNode[];
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-[--radius-md] border border-dashed border-border-light bg-bg-base">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-text-muted">{open ? "▾" : "▸"}</span>
        <span className="text-base">{icon}</span>
        <span className="font-bold text-text-secondary">{label}</span>
        <span className="text-[11px] font-semibold text-text-muted">
          · {nodes.length} {hint}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border-light/60">
          {nodes.map((node) => (
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
// variations. The variation badge is the standout new visual element.
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
    <div className="bg-surface">
      <BankRow
        item={node.item}
        unitLabel={labelForUnit(units, node.item.unit_id)}
        showUnit={false}
        hideUsedInPills
        onOpen={() => onOpenItem(node.item)}
        onOpenHomework={onOpenHomework}
        onChanged={onChanged}
      />
      {/* Variation badge — sits below the row, indented to align with
          the question text. Green when variations exist, amber when zero. */}
      <div className="ml-7 mb-2 flex items-center gap-2">
        {hasVariations ? (
          <button
            type="button"
            onClick={() => setVariationsOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-1 text-[11px] font-bold text-purple-800 hover:bg-purple-200 dark:bg-purple-500/20 dark:text-purple-300 dark:hover:bg-purple-500/30"
          >
            <span>{variationsOpen ? "▾" : "▸"}</span>
            <span>
              ✨ {approvedChildren} practice variation{approvedChildren === 1 ? "" : "s"}
            </span>
            {pendingChildren > 0 && (
              <span className="ml-1 rounded-full bg-purple-200 px-1.5 text-[9px] dark:bg-purple-500/30">
                {pendingChildren} pending
              </span>
            )}
          </button>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-amber-400 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400">
              ⚠️ No practice variations yet
            </span>
            <button
              type="button"
              onClick={() => onOpenItem(node.item)}
              className="rounded-full bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-700"
              title="Open the question to generate similar variations"
            >
              Generate →
            </button>
          </>
        )}
      </div>
      {hasVariations && variationsOpen && (
        <div className="ml-6 border-l-2 border-purple-200 dark:border-purple-500/30">
          {node.children.map((child) => (
            <BankRow
              key={child.id}
              item={child}
              unitLabel={labelForUnit(units, child.unit_id)}
              showUnit={false}
              variation
              hideUsedInPills
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
