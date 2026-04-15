"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import type { BankItem, TeacherUnit } from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { QuestionRow } from "./question-row";

interface PendingSectionsProps {
  items: BankItem[];
  units: TeacherUnit[];
  /** Open the WorkshopModal in single-item mode for a primary review. */
  onOpenItem: (item: BankItem) => void;
  /** Start the queue review for ALL pending primary questions. */
  onReviewAllNew: () => void;
  /** Start the variation queue review for a specific parent. */
  onReviewVariationsForParent: (parentId: string) => void;
  /** A pre-fetched lookup of approved parents by id, so practice
   *  problem groups can render the parent's title without a refetch. */
  parentLookup?: Map<string, BankItem>;
}

/**
 * Pending tab body. Two stacked sections — one for primary "new
 * questions" awaiting approval, one for practice variations grouped by
 * the parent question they scaffold.
 */
export function PendingSections({
  items,
  units,
  onOpenItem,
  onReviewAllNew,
  onReviewVariationsForParent,
  parentLookup,
}: PendingSectionsProps) {
  const primaries = useMemo(
    () => items.filter((i) => !i.parent_question_id),
    [items],
  );
  const variations = useMemo(
    () => items.filter((i) => i.parent_question_id),
    [items],
  );

  // Group variations by parent_question_id
  const variationGroups = useMemo(() => {
    const groups = new Map<string, BankItem[]>();
    for (const v of variations) {
      const pid = v.parent_question_id;
      if (!pid) continue;
      const arr = groups.get(pid) ?? [];
      arr.push(v);
      groups.set(pid, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [variations]);

  if (primaries.length === 0 && variationGroups.length === 0) {
    return (
      <EmptyPending />
    );
  }

  return (
    <div className="space-y-8">
      {primaries.length > 0 && (
        <Section
          label="New questions"
          count={primaries.length}
          actionLabel="Review all"
          onAction={onReviewAllNew}
        >
          <div className="space-y-2">
            {primaries.map((item) => (
              <QuestionRow
                key={item.id}
                item={item}
                units={units}
                emphasis="pending"
                onClick={onOpenItem}
                action={
                  <span className="text-[11px] font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Review →
                  </span>
                }
              />
            ))}
          </div>
        </Section>
      )}

      {variationGroups.length > 0 && (
        <Section
          label="Practice problems"
          count={variations.length}
          subtitle={`${variationGroups.length} parent question${variationGroups.length === 1 ? "" : "s"}`}
        >
          <div className="space-y-2">
            {variationGroups.map(([parentId, vs]) => {
              const parent = parentLookup?.get(parentId);
              return (
                <VariationGroupRow
                  key={parentId}
                  parent={parent}
                  pendingCount={vs.length}
                  onViewParent={() => parent && onOpenItem(parent)}
                  onReview={() => onReviewVariationsForParent(parentId)}
                />
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  label,
  count,
  subtitle,
  actionLabel,
  onAction,
  children,
}: {
  label: string;
  count: number;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-secondary">
            {label}
          </h2>
          <span className="text-[11px] font-semibold text-text-muted">{count}</span>
          {subtitle && <span className="text-[11px] text-text-muted">· {subtitle}</span>}
        </div>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="text-[12px] font-semibold text-primary hover:text-primary-dark"
          >
            {actionLabel} →
          </button>
        )}
      </header>
      {children}
    </motion.section>
  );
}

function VariationGroupRow({
  parent,
  pendingCount,
  onViewParent,
  onReview,
}: {
  parent?: BankItem;
  pendingCount: number;
  onViewParent: () => void;
  onReview: () => void;
}) {
  // The parent question is fetched out-of-band (parentLookup); it might
  // not be loaded yet when this renders. Fall back to a plain card with
  // no preview/click — Review still works because it uses the parent_id
  // which the variation already carries.
  const hasParent = !!parent;

  return (
    <div className="rounded-[--radius-md] border border-amber-200 bg-amber-50/40 p-3 transition-all hover:border-amber-300 dark:border-amber-500/30 dark:bg-amber-500/5">
      <div className="flex items-baseline justify-between gap-2 px-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
        <span>↳ Practice problems for</span>
        <span className="text-amber-700 dark:text-amber-300">
          {pendingCount} pending
        </span>
      </div>
      <button
        type="button"
        onClick={hasParent ? onViewParent : undefined}
        disabled={!hasParent}
        className="group mt-1.5 block w-full rounded-[--radius-sm] px-1 py-1 text-left transition-colors hover:bg-amber-100/40 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-amber-500/10"
        title={hasParent ? "View the original problem" : undefined}
      >
        <div className="line-clamp-1 text-sm font-bold text-text-primary group-hover:text-primary">
          {parent?.title ?? "Loading parent question..."}
        </div>
        {parent && (
          <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">
            <MathText text={parent.question} />
          </div>
        )}
      </button>
      <div className="mt-2 flex items-center justify-end gap-3 px-1 text-[11px] font-semibold">
        {hasParent && (
          <button
            type="button"
            onClick={onViewParent}
            className="text-text-secondary hover:text-primary hover:underline"
          >
            View original
          </button>
        )}
        <button
          type="button"
          onClick={onReview}
          className="rounded-[--radius-md] bg-amber-600 px-3 py-1 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
        >
          Review practice →
        </button>
      </div>
    </div>
  );
}

function EmptyPending() {
  return (
    <div className="rounded-[--radius-lg] border border-dashed border-border-light bg-bg-subtle/40 py-16 text-center">
      <p className="text-sm font-semibold text-text-secondary">All caught up</p>
      <p className="mt-1 text-[12px] text-text-muted">
        Generate or upload questions to get started.
      </p>
    </div>
  );
}
