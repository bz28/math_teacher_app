"use client";

import { motion } from "framer-motion";

interface ProgressBarProps {
  /** 0..100, gets clamped. */
  value: number;
}

/**
 * Slim animated progress bar used by both personal and school
 * student practice/learn surfaces. Pure render — caller computes
 * the percentage.
 */
export function ProgressBar({ value }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-border-light">
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
        animate={{ width: `${clamped}%` }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
      />
    </div>
  );
}
