"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { teacher, type BankItem, type TeacherUnit } from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { DIFFICULTY_STYLE } from "./constants";

interface PracticeProblemsModalProps {
  parent: BankItem;
  units: TeacherUnit[];
  onClose: () => void;
  /** Open one practice problem in the WorkshopModal. */
  onOpenItem: (item: BankItem) => void;
  /** Trigger the generate-similar dialog for this parent. */
  onGenerateMore: () => void;
}

/**
 * Compact panel listing the practice problems (variations) generated
 * from a single parent question. Loaded on open via two bank fetches
 * (approved + pending children). Click a row to open it in the
 * Workshop; click "Generate more" to schedule additional ones.
 */
export function PracticeProblemsModal({
  parent,
  units,
  onClose,
  onOpenItem,
  onGenerateMore,
}: PracticeProblemsModalProps) {
  const [items, setItems] = useState<BankItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      teacher.bank(parent.course_id, { status: "approved" }),
      teacher.bank(parent.course_id, { status: "pending" }),
    ])
      .then(([approved, pending]) => {
        if (cancelled) return;
        const children = [
          ...approved.items.filter((i) => i.parent_question_id === parent.id),
          ...pending.items.filter((i) => i.parent_question_id === parent.id),
        ];
        setItems(children);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load practice problems");
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [parent.id, parent.course_id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18 }}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-border-light px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                Practice problems for
              </div>
              <h2 className="mt-1 line-clamp-2 text-base font-bold text-text-primary">
                {parent.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-bg-subtle/40 px-4 py-4">
          {items === null ? (
            <div className="space-y-2">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : items.length === 0 ? (
            <EmptyState onGenerate={onGenerateMore} />
          ) : (
            <ul className="space-y-2">
              {items.map((item, i) => (
                <PracticeRow
                  key={item.id}
                  item={item}
                  index={i + 1}
                  units={units}
                  onClick={() => onOpenItem(item)}
                />
              ))}
            </ul>
          )}
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border-light px-6 py-3">
          <span className="text-[11px] text-text-muted">
            {items === null
              ? "Loading…"
              : `${items.length} practice problem${items.length === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            onClick={onGenerateMore}
            className="rounded-[--radius-md] bg-primary px-3.5 py-2 text-sm font-bold text-white hover:bg-primary-dark"
          >
            ✨ Generate more
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function PracticeRow({
  item,
  index,
  units,
  onClick,
}: {
  item: BankItem;
  index: number;
  units: TeacherUnit[];
  onClick: () => void;
}) {
  const diff = DIFFICULTY_STYLE[item.difficulty];
  const isPending = item.status === "pending";
  const unitName = units.find((u) => u.id === item.unit_id)?.name ?? null;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group block w-full rounded-[--radius-md] border border-border-light bg-surface px-4 py-3 text-left transition-all hover:border-primary/40 hover:shadow-sm"
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              isPending
                ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20"
                : "bg-primary-bg text-primary"
            }`}
          >
            {index}
          </span>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-sm text-text-primary group-hover:text-primary">
              <MathText text={item.question} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-text-muted">
              <span
                className={`rounded-[--radius-pill] px-1.5 py-0.5 uppercase tracking-wider ${
                  isPending
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                    : "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                }`}
              >
                {item.status}
              </span>
              {diff && (
                <span className={`rounded-[--radius-pill] px-1.5 py-0.5 ${diff.cls}`}>
                  {diff.label}
                </span>
              )}
              {unitName && <span className="text-text-muted/80">· {unitName}</span>}
            </div>
          </div>
        </div>
      </button>
    </li>
  );
}

function SkeletonRow() {
  return (
    <div className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-bg-subtle" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-3/4 animate-pulse rounded bg-bg-subtle" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-bg-subtle" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[--radius-md] border border-dashed border-border-light bg-surface py-10 text-center">
      <p className="text-sm font-semibold text-text-secondary">
        No practice problems yet
      </p>
      <p className="mt-1 text-[12px] text-text-muted">
        Generate similar problems for students to practice with.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        className="mt-4 rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark"
      >
        ✨ Generate practice problems
      </button>
    </div>
  );
}
