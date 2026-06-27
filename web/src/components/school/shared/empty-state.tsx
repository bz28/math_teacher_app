"use client";

import { type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Editorial empty state for the school workspace — a gently floating icon,
 * a serif title, and a muted line of guidance. Matches the Student Insights
 * RosterEmpty register (serif + muted) and the personal app's crafted
 * EmptyState (floating icon), so "nothing here yet" reads as intentional
 * rather than a bare placeholder.
 *
 * `text` is the legacy single-line API (renders as the title); pass
 * `title` + `description` for the two-line editorial treatment.
 */
function DefaultIcon() {
  return (
    <svg
      className="h-9 w-9 text-primary/60"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

interface EmptyStateProps {
  text?: string;
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  text,
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  const reduce = useReducedMotion();
  const heading = title ?? text ?? "";
  const rise = reduce
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="mt-4 flex flex-col items-center rounded-[--radius-lg] border border-border-light bg-bg-subtle px-6 py-12 text-center">
      <motion.div
        animate={reduce ? undefined : { y: [0, -7, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="mb-3"
      >
        {icon ?? <DefaultIcon />}
      </motion.div>
      <motion.p
        {...rise}
        transition={{ delay: 0.08 }}
        className="max-w-md font-serif text-[18px] leading-snug text-text-primary"
      >
        {heading}
      </motion.p>
      {description && (
        <motion.p
          {...rise}
          transition={{ delay: 0.16 }}
          className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-text-muted"
        >
          {description}
        </motion.p>
      )}
      {action && (
        <motion.div {...rise} transition={{ delay: 0.24 }} className="mt-4">
          {action}
        </motion.div>
      )}
    </div>
  );
}
