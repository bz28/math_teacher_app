"use client";

import type { BankItem } from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { DIFFICULTY_STYLE } from "./constants";

/**
 * One approved bank question in the Add-from-bank picker: a checkbox, its
 * title, two lines of the question, and tags for what changes how it's
 * taught (a figure, its difficulty). The whole row is the label, so the
 * hit area is the row, not the 15px box.
 */
export function QuestionRow({
  item,
  checked,
  onToggle,
  disabled,
}: {
  item: BankItem;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const difficulty = DIFFICULTY_STYLE[item.difficulty];
  return (
    <label
      className={`grid cursor-pointer grid-cols-[22px_1fr_auto] items-start gap-3 border-t border-border-light px-1 py-2.5 text-sm transition-colors hover:bg-bg-subtle/60 ${
        checked ? "bg-primary-bg/20" : ""
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 accent-[color:var(--color-primary)]"
      />
      <span className="min-w-0">
        <span className="block font-semibold text-text-primary">
          {item.title || "Untitled question"}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-text-muted">
          <MathText text={item.question} />
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {item.figure_svg && <Tag label="figure" />}
        {difficulty && <Tag label={difficulty.label} className={difficulty.cls} />}
      </span>
    </label>
  );
}

function Tag({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={`whitespace-nowrap rounded-[--radius-sm] px-1.5 py-0.5 text-[10.5px] font-semibold ${
        className ?? "bg-bg-subtle text-text-muted"
      }`}
    >
      {label}
    </span>
  );
}
