import { UNFINISHED_CHECK_TITLE } from "@/components/school/teacher/_pieces/integrity-pieces";
import type { IntegrityBannerKey } from "./types";

export const NEUTRAL_STYLE = {
  bg: "bg-[color:var(--color-surface-alt-2)]",
  border: "border-border-light",
  iconBg: "bg-gray-400 text-white dark:bg-gray-500",
};

export const INTEGRITY_STYLE: Record<
  IntegrityBannerKey,
  { bg: string; border: string; iconBg: string; icon: string; label: string }
> = {
  pass: {
    bg: "bg-green-50 dark:bg-green-900/20",
    border: "border-green-200 dark:border-green-900/40",
    iconBg: "bg-green-600 text-white",
    icon: "✓",
    label: "Student understood their own work",
  },
  needs_practice: {
    bg: "bg-blue-50 dark:bg-blue-900/20",
    border: "border-blue-200 dark:border-blue-900/40",
    iconBg: "bg-blue-600 text-white",
    icon: "↻",
    label: "Procedural knowledge — consider revisiting the concept",
  },
  tutor_pivot: {
    bg: "bg-[color:var(--color-warning-bg)]",
    border: "border-[color:var(--color-warning)]/30",
    iconBg: "bg-[color:var(--color-warning-dark)] text-white",
    icon: "?",
    label: "Student was lost — got tutored through it",
  },
  flag_for_review: {
    bg: "bg-[color:var(--color-error-light)] ",
    border: "border-[color:var(--color-error-border)] ",
    iconBg: "bg-[color:var(--color-error)] text-white",
    icon: "⚑",
    label: "Review — correct work but couldn't explain it",
  },
  needs_review: {
    ...NEUTRAL_STYLE,
    icon: "◌",
    label: "Inconclusive — teacher review",
  },
  // Dashed border + outlined ◐: the same "something is missing" mark as
  // the roster pill, and deliberately no verdict color.
  unfinished: {
    bg: "bg-[color:var(--color-surface-alt-2)]",
    border: "border-dashed border-text-muted/60",
    iconBg: "border border-text-muted/70 bg-surface text-text-secondary",
    icon: "◐",
    label: UNFINISHED_CHECK_TITLE,
  },
  extracting: {
    ...NEUTRAL_STYLE,
    icon: "…",
    label: "Preparing the integrity check…",
  },
  awaiting_student: {
    ...NEUTRAL_STYLE,
    icon: "·",
    label: "Integrity check hasn't been started yet",
  },
  in_progress: {
    ...NEUTRAL_STYLE,
    icon: "…",
    label: "Integrity check running",
  },
  skipped_unreadable: {
    ...NEUTRAL_STYLE,
    icon: "·",
    label: "Couldn't read student's work — review their submission",
  },
};
