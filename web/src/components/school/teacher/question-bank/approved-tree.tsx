"use client";

import { useMemo, useState } from "react";
import type { BankItem, TeacherUnit } from "@/lib/api";
import { unitLabel as labelForUnit, topUnitIdOf } from "@/lib/units";
import { MathText } from "@/components/shared/math-text";
import { FolderIcon, FolderOpenIcon } from "@/components/ui/icons";
import { DIFFICULTY_STYLE } from "./constants";
import { buildTree, type TreeNode } from "./tree";

// Approved view, v2.
//
// Structure (matches the teacher's mental model: "my homeworks,
// grouped by unit"):
//
//   📁 Math
//      📝 hw 1: Quadratics  [draft]    Open ↗
//         (auto-collapsed by default)
//         expanded → fat problem cards with the question text
//      📝 hw 2: Linear equations  [draft]
//   📁 Chemistry
//      📝 hw 3: Reactions  [published]
//
// Grouping primary key is `assignment.unit_ids` (the HW's own units),
// not the question's unit. This means a HW that borrows a problem
// from another unit still appears under its declared unit, exactly
// once. Multi-unit HWs (midterms) appear under each of their units.
//
// HWs are rendered as cards with a state-only collapsed header
// (title, status, problem count, variation health). Click to expand
// → see the actual problems as fat cards with math-rendered text.
export function ApprovedView({
  items,
  units,
  onOpenItem,
  onOpenHomework,
}: {
  items: BankItem[];
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
  /** Used by the HW header's "Open ↗" button to jump to the
   *  HomeworkDetailModal. ProblemCard rows do NOT use this — clicking
   *  a card opens the WorkshopModal via onOpenItem instead. */
  onOpenHomework: (id: string) => void;
}) {
  // Build the unit → HW → primaries grouping. A HW with multiple
  // unit_ids is shown under each of its units (intentional, explicit
  // teacher decision — not the implicit duplication bug v1 had).
  // Primaries with no HW reference fall into "Unattached" or
  // "In a test or quiz" depending on whether they're in any
  // assignment at all.
  const { unitGroups, inTestOrQuiz, unattached } = useMemo(() => {
    const tree = buildTree(items);

    type Hw = { id: string; title: string; status: string; unit_ids: string[]; nodes: TreeNode[] };
    // hwId → Hw (deduped — same HW only appears in one Hw object)
    const hwById = new Map<string, Hw>();
    const inTestOrQuiz: TreeNode[] = [];
    const unattached: TreeNode[] = [];

    for (const node of tree) {
      const homeworkRefs = node.item.used_in.filter((u) => u.type === "homework");
      if (homeworkRefs.length > 0) {
        for (const hw of homeworkRefs) {
          let entry = hwById.get(hw.id);
          if (!entry) {
            entry = {
              id: hw.id,
              title: hw.title,
              status: hw.status,
              unit_ids: hw.unit_ids,
              nodes: [],
            };
            hwById.set(hw.id, entry);
          }
          entry.nodes.push(node);
        }
        continue;
      }
      if (node.item.used_in.length > 0) {
        inTestOrQuiz.push(node);
      } else {
        unattached.push(node);
      }
    }

    // Group HWs by their unit_ids. A multi-unit HW appears under each
    // of its units. A HW with no unit_ids (shouldn't happen with the
    // new required-unit validation, but defensive) falls under a
    // "No unit" bucket.
    type UnitGroup = { id: string; label: string; hws: Hw[] };
    const unitGroupMap = new Map<string, UnitGroup>();
    const noUnitHws: Hw[] = [];

    for (const hw of hwById.values()) {
      if (hw.unit_ids.length === 0) {
        noUnitHws.push(hw);
        continue;
      }
      for (const unitId of hw.unit_ids) {
        let g = unitGroupMap.get(unitId);
        if (!g) {
          g = { id: unitId, label: labelForUnit(units, unitId), hws: [] };
          unitGroupMap.set(unitId, g);
        }
        g.hws.push(hw);
      }
    }

    // Sort: units alphabetically by label; HWs alphabetically by title within each.
    const unitGroups = Array.from(unitGroupMap.values())
      .map((g) => ({
        ...g,
        hws: g.hws.slice().sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (noUnitHws.length > 0) {
      unitGroups.push({
        id: "__no_unit__",
        label: "No unit",
        hws: noUnitHws.slice().sort((a, b) => a.title.localeCompare(b.title)),
      });
    }

    return { unitGroups, inTestOrQuiz, unattached };
  }, [items, units]);

  if (unitGroups.length === 0 && inTestOrQuiz.length === 0 && unattached.length === 0) {
    return (
      <div className="rounded-[--radius-md] border border-dashed border-border-light px-4 py-12 text-center text-sm italic text-text-muted">
        No approved questions yet. Review some pending ones to add them to a homework.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {unitGroups.map((group) => (
        <UnitSection
          key={group.id}
          label={group.label}
          hws={group.hws}
          units={units}
          onOpenItem={onOpenItem}
          onOpenHomework={onOpenHomework}
        />
      ))}

      {(inTestOrQuiz.length > 0 || unattached.length > 0) && (
        <div className="space-y-3">
          {inTestOrQuiz.length > 0 && (
            <SecondarySection
              icon="📊"
              label="In a test or quiz only"
              hint="not in any homework"
              nodes={inTestOrQuiz}
              units={units}
              onOpenItem={onOpenItem}
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
            />
          )}
        </div>
      )}
    </div>
  );
}

// Unit section header + a stack of HW cards. The unit header is flat
// (no card container) so the HW cards inside are the visual focus.
function UnitSection({
  label,
  hws,
  units,
  onOpenItem,
  onOpenHomework,
}: {
  label: string;
  hws: { id: string; title: string; status: string; unit_ids: string[]; nodes: TreeNode[] }[];
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
  onOpenHomework: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const totalProblems = hws.reduce((sum, hw) => sum + hw.nodes.length, 0);

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
          {hws.length} {hws.length === 1 ? "homework" : "homeworks"} · {totalProblems}{" "}
          {totalProblems === 1 ? "problem" : "problems"}
        </span>
        <span className="shrink-0 text-text-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="space-y-3">
          {hws.map((hw) => (
            <HomeworkCard
              key={hw.id}
              hw={hw}
              units={units}
              onOpenItem={onOpenItem}
              onOpenHomework={onOpenHomework}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// HW card. Auto-collapsed by default — the collapsed header
// communicates STATE (title, draft/published, problem count, variation
// health), not content. Expanded shows the fat problem cards.
function HomeworkCard({
  hw,
  units,
  onOpenItem,
  onOpenHomework,
}: {
  hw: { id: string; title: string; status: string; unit_ids: string[]; nodes: TreeNode[] };
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
  onOpenHomework: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isPublished = hw.status === "published";

  const totalProblems = hw.nodes.length;
  const problemsWithVariations = hw.nodes.filter((n) => n.children.length > 0).length;
  const needsVariations = totalProblems - problemsWithVariations;

  return (
    <div className="overflow-hidden rounded-[--radius-lg] border border-border-light bg-surface shadow-sm">
      {/* Collapsed/expandable header — state-only, no content preview. */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="text-text-muted">{open ? "▾" : "▸"}</span>
          <span className="text-base" aria-hidden>
            📝
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="min-w-0 truncate text-sm font-bold text-text-primary">
                {hw.title}
              </h4>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                  isPublished
                    ? "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300"
                    : "border border-text-muted/40 text-text-muted"
                }`}
              >
                {isPublished ? "published" : "draft"}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">
              {totalProblems} {totalProblems === 1 ? "problem" : "problems"}
              {needsVariations > 0 && (
                <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">
                  · ⚠️ {needsVariations} need variations
                </span>
              )}
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => onOpenHomework(hw.id)}
          className="shrink-0 rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-subtle hover:text-text-primary"
          title="Open homework"
        >
          Open ↗
        </button>
      </div>

      {open && (
        <div className="border-t border-border-light bg-bg-base/50 p-3 space-y-2">
          {hw.nodes.map((node) => (
            <ProblemCard
              key={node.item.id}
              hwUnitIds={hw.unit_ids}
              node={node}
              units={units}
              onOpenItem={onOpenItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One problem card. The question text is the focal element, math-
// rendered, capped at 2 lines so heavy expressions don't blow out the
// card. A single thin metadata strip underneath: difficulty pill,
// "from <unit>" chip if the problem's unit differs from the HW's,
// variation badge (purple = healthy, amber = needs generation),
// kebab on the right.
function ProblemCard({
  hwUnitIds,
  node,
  units,
  onOpenItem,
}: {
  /** Units of the parent HW. Used to detect cross-unit borrowing. */
  hwUnitIds: string[];
  node: TreeNode;
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
}) {
  const item = node.item;
  const [variationsOpen, setVariationsOpen] = useState(false);
  const childrenCount = node.children.length;
  const approvedChildren = node.children.filter((c) => c.status === "approved").length;
  const pendingChildren = node.children.filter((c) => c.status === "pending").length;
  const hasVariations = childrenCount > 0;

  // Borrowed = the problem's TOP unit isn't in the HW's units list.
  // Roll the item's unit_id up to its top so a question saved into a
  // subfolder of the HW's unit isn't mistakenly flagged as borrowed.
  const itemTopUnit = topUnitIdOf(units, item.unit_id);
  const borrowed =
    itemTopUnit !== null && hwUnitIds.length > 0 && !hwUnitIds.includes(itemTopUnit);
  const itemUnitLabel = labelForUnit(units, item.unit_id);

  // Outer wrapper is a <div>, not a <button>, so we can nest the
  // variation-toggle button. The big "open question" hit area is its
  // own button that fills the row.
  return (
    <div className="rounded-[--radius-md] border border-border-light bg-surface transition-colors hover:border-primary/40">
      <button
        type="button"
        onClick={() => onOpenItem(item)}
        className="block w-full px-4 py-3 text-left hover:bg-bg-subtle"
      >
        {/* Question text — focal element, math-rendered, capped at
            2 lines via line-clamp so heavy expressions don't explode. */}
        <div className="line-clamp-2 text-[15px] leading-snug text-text-primary">
          <MathText text={item.question} />
        </div>

        {/* Metadata strip — single thin row, low contrast. The
            variation badge sits here as a span (it's not clickable
            from inside the parent button — its expander is a
            sibling button below). */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <DifficultyPill difficulty={item.difficulty} />
          {borrowed && (
            <span
              className="rounded-full bg-bg-subtle px-1.5 py-0.5 font-semibold text-text-muted"
              title={`Originally from ${itemUnitLabel}`}
            >
              from {itemUnitLabel}
            </span>
          )}
          {!hasVariations && (
            <span className="rounded-full border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 font-bold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400">
              ⚠️ no practice variations
            </span>
          )}
        </div>
      </button>

      {/* Variations expander — outside the parent button so it's an
          independent clickable target. Click to expand and see the
          approved children inline (and any pending ones, though those
          are normally reviewed via the pending tray). */}
      {hasVariations && (
        <div className="border-t border-border-light/50 px-4 py-2">
          <button
            type="button"
            onClick={() => setVariationsOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-bold text-purple-800 hover:bg-purple-200 dark:bg-purple-500/20 dark:text-purple-300 dark:hover:bg-purple-500/30"
          >
            <span>{variationsOpen ? "▾" : "▸"}</span>
            <span>
              ✨ {approvedChildren} variation{approvedChildren === 1 ? "" : "s"}
            </span>
            {pendingChildren > 0 && (
              <span className="ml-0.5 opacity-70">· {pendingChildren} pending</span>
            )}
          </button>
          {variationsOpen && (
            <div className="mt-2 space-y-1.5 border-l-2 border-purple-200 pl-3 dark:border-purple-500/30">
              {node.children.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => onOpenItem(child)}
                  className="block w-full rounded-[--radius-sm] border border-border-light/60 bg-bg-base/40 px-3 py-2 text-left hover:border-primary/40 hover:bg-bg-subtle"
                >
                  <div className="line-clamp-2 text-[13px] leading-snug text-text-primary">
                    <MathText text={child.question} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px]">
                    <DifficultyPill difficulty={child.difficulty} />
                    {child.status === "pending" && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-400">
                        pending
                      </span>
                    )}
                    {child.status === "rejected" && (
                      <span className="rounded-full bg-bg-subtle px-1.5 py-0.5 font-bold text-text-muted">
                        rejected
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DifficultyPill({ difficulty }: { difficulty: string }) {
  const style = DIFFICULTY_STYLE[difficulty];
  if (!style) return null;
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style.cls}`}
    >
      {style.label}
    </span>
  );
}

// Generic non-HW section: holds primaries that are either in a test/
// quiz only (test scope is deferred) or truly orphaned. Auto-collapsed.
function SecondarySection({
  icon,
  label,
  hint,
  nodes,
  units,
  onOpenItem,
}: {
  icon: string;
  label: string;
  hint: string;
  nodes: TreeNode[];
  units: TeacherUnit[];
  onOpenItem: (item: BankItem) => void;
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
        <div className="space-y-2 border-t border-border-light p-3">
          {nodes.map((node) => (
            <ProblemCard
              key={node.item.id}
              hwUnitIds={[]}
              node={node}
              units={units}
              onOpenItem={onOpenItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}
