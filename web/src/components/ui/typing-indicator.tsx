"use client";

import { motion } from "framer-motion";

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 rounded-[--radius-md] bg-primary-bg px-4 py-3">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full bg-primary"
            animate={{ y: [-2, 2, -2] }}
            transition={{
              duration: 0.6,
              repeat: Infinity,
              delay: i * 0.15,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
    </div>
  );
}
