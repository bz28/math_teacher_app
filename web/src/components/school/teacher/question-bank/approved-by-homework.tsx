"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { BankItem, TeacherUnit } from "@/lib/api";
import { QuestionRow } from "./question-row";
import { buildTree } from "./tree";

interface ApprovedByHomeworkProps {
  items: BankItem[];
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
  /** Open the variation review queue for a specific parent question. */
  onReviewVariations: (parent: BankItem) => void;
  /** Open the generate-similar dialog for a specific parent question. */
  onGenerateMore: (parent: BankItem) => void;
  /** Open the practice-problems detail modal for a specific parent. */
  onViewPractice: (parent: BankItem) => void;
}

type Group = {
  /** Synthetic key — assignment id, or "__unassigned__". */
  id: string;
  title: string;
  /** Type chip — used to render a small label next to title. */
  typeLabel: string | null;
  /** Status (draft / published) to render a small badge. */
  status: string | null;
  /** Items belonging to this group. */
  items: BankItem[];
};

const UNASSIGNED_KEY = "__unassigned__";

/**
 * Approved tab body. Groups items by the homework they're attached to
 * (via item.used_in). Each group is collapsible with a header showing
 * the homework title + count. Practice variations nest under their
 * parent question on a thin secondary line.
 */
export function ApprovedByHomework({
  items,
  units,
  onOpenItem,
  onReviewVariations,
  onGenerateMore,
  onViewPractice,
}: ApprovedByHomeworkProps) {
  // Tree: parent items + their child variations.
  const tree = useMemo(() => buildTree(items), [items]);

  // Group root items by the first homework they're attached to. A
  // single question CAN appear in multiple homeworks; for grouping we
  // pick the first to keep the layout simple. (Future: render the
  // question once per homework if teachers want that.)
  const groups = useMemo<Group[]>(() => {
    const byHw = new Map<string, Group>();
    const unassigned: BankItem[] = [];

    for (const node of tree) {
      const item = node.item;
      const firstHw = item.used_in[0];
      if (!firstHw) {
        unassigned.push(item);
        continue;
      }
      const existing = byHw.get(firstHw.id);
      if (existing) {
        existing.items.push(item);
      } else {
        byHw.set(firstHw.id, {
          id: firstHw.id,
          title: firstHw.title,
          typeLabel: firstHw.type,
          status: firstHw.status,
          items: [item],
        });
      }
    }

    const sorted = Array.from(byHw.values()).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    if (unassigned.length > 0) {
      sorted.push({
        id: UNASSIGNED_KEY,
        title: "Not yet in a homework",
        typeLabel: null,
        status: null,
        items: unassigned,
      });
    }
    return sorted;
  }, [tree]);

  // Children-by-parent lookup so each row can show its practice line
  // without re-scanning the tree.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, BankItem[]>();
    for (const node of tree) map.set(node.item.id, node.children);
    return map;
  }, [tree]);

  if (groups.length === 0) {
    return (
      <div className="rounded-[--radius-lg] border border-dashed border-border-light bg-bg-subtle/40 py-16 text-center">
        <p className="text-sm font-semibold text-text-secondary">No approved questions yet</p>
        <p className="mt-1 text-[12px] text-text-muted">
          Approved questions will be grouped by homework here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group, idx) => (
        <HomeworkGroup
          key={group.id}
          group={group}
          units={units}
          childrenByParent={childrenByParent}
          onOpenItem={onOpenItem}
          onReviewVariations={onReviewVariations}
          onGenerateMore={onGenerateMore}
          onViewPractice={onViewPractice}
          defaultOpen={idx === 0 && groups.length <= 3}
        />
      ))}
    </div>
  );
}

function HomeworkGroup({
  group,
  units,
  childrenByParent,
  onOpenItem,
  onReviewVariations,
  onGenerateMore,
  onViewPractice,
  defaultOpen,
}: {
  group: Group;
  units: TeacherUnit[];
  childrenByParent: Map<string, BankItem[]>;
  onOpenItem: (item: BankItem) => void;
  onReviewVariations: (parent: BankItem) => void;
  onGenerateMore: (parent: BankItem) => void;
  onViewPractice: (parent: BankItem) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isUnassigned = group.id === UNASSIGNED_KEY;

  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="overflow-hidden rounded-[--radius-lg] border border-border-light bg-surface"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-bg-subtle/40"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
              open ? "bg-primary text-white" : "bg-bg-subtle text-text-muted"
            }`}
            aria-hidden
          >
            {open ? "▾" : "▸"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3 className="line-clamp-1 text-sm font-bold text-text-primary">
                {group.title}
              </h3>
              {group.status && group.status !== "published" && (
                <span className="rounded-[--radius-pill] bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  {group.status}
                </span>
              )}
              {isUnassigned && (
                <span className="text-[10px] italic text-text-muted">orphan</span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {group.items.length} question{group.items.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-border-light bg-bg-subtle/30 px-3 py-3">
              {group.items.map((item) => {
                const variations = childrenByParent.get(item.id) ?? [];
                const approvedVars = variations.filter((v) => v.status === "approved").length;
                const pendingVars = variations.filter((v) => v.status === "pending").length;
                return (
                  <QuestionRow
                    key={item.id}
                    item={item}
                    units={units}
                    emphasis="approved"
                    onClick={onOpenItem}
                    trailing={
                      <PracticeLine
                        approvedCount={approvedVars}
                        pendingCount={pendingVars}
                        onView={() => onViewPractice(item)}
                        onReview={() => onReviewVariations(item)}
                        onGenerate={() => onGenerateMore(item)}
                      />
                    }
                  />
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function PracticeLine({
  approvedCount,
  pendingCount,
  onView,
  onReview,
  onGenerate,
}: {
  approvedCount: number;
  pendingCount: number;
  onView: () => void;
  onReview: () => void;
  onGenerate: () => void;
}) {
  const total = approvedCount + pendingCount;
  return (
    <div className="flex items-center gap-3 text-[11px] text-text-muted">
      <span className="text-[10px]">↳</span>
      {total === 0 ? (
        <span>No practice problems yet</span>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
          className="font-semibold text-text-secondary hover:text-primary hover:underline"
        >
          {approvedCount} practice problem{approvedCount === 1 ? "" : "s"}
          {pendingCount > 0 && (
            <span className="ml-1 rounded-[--radius-pill] bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              +{pendingCount} pending
            </span>
          )}
        </button>
      )}
      <span className="ml-auto flex items-center gap-3">
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
            className="text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-300"
          >
            Review pending
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onGenerate();
          }}
          className="text-[11px] font-semibold text-primary hover:underline"
        >
          ✨ Generate more
        </button>
      </span>
    </div>
  );
}
