"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface PageMastheadProps {
  /** Small tracked uppercase label above the title — e.g. the date or a section. */
  eyebrow?: string;
  /** The editorial serif headline. */
  title: ReactNode;
  /** A quiet one-line invitation/description under the title. */
  subtitle?: ReactNode;
  /** Hairline divider closing the masthead (editorial section rule). */
  rule?: boolean;
  /** Optional trailing element (e.g. a settings button) aligned to the title row. */
  action?: ReactNode;
}

/**
 * The shared editorial masthead — a tracked eyebrow, a large Instrument Serif
 * headline, and a quiet subtitle, closed by a hairline rule. One masthead voice
 * across every page so the surfaces read like one publication, not many.
 */
export function PageMasthead({ eyebrow, title, subtitle, rule = true, action }: PageMastheadProps) {
  return (
    <header>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {eyebrow !== undefined && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            {eyebrow || " "}
          </p>
        )}
        <div className="mt-3 flex items-start justify-between gap-4">
          <h1 className="font-serif text-[2.5rem] leading-[1.05] text-text-primary sm:text-[3rem]">
            {title}
          </h1>
          {action && <div className="shrink-0 pt-2">{action}</div>}
        </div>
        {subtitle && (
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-text-secondary">{subtitle}</p>
        )}
      </motion.div>
      {rule && <div className="mt-8 h-px w-full bg-border" />}
    </header>
  );
}
