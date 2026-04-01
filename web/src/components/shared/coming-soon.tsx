"use client";

import { motion } from "framer-motion";

export function ComingSoon({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center py-20 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary-bg text-primary"
      >
        {icon}
      </motion.div>
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-2xl font-extrabold tracking-tight text-text-primary"
      >
        {title}
      </motion.h1>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="mt-2 inline-flex items-center gap-1.5 rounded-[--radius-pill] bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-600 dark:bg-amber-500/10"
      >
        Coming Soon
      </motion.div>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mt-4 text-sm leading-relaxed text-text-secondary"
      >
        {description}
      </motion.p>
    </div>
  );
}
