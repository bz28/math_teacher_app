"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { useThemeStore } from "@/stores/theme";

export function ThemeToggle() {
  const { setting, resolved, toggle, hydrate } = useThemeStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const label =
    setting === "system"
      ? "Using system theme"
      : setting === "dark"
        ? "Switch to system theme"
        : "Switch to dark mode";

  return (
    <button
      onClick={toggle}
      className="flex h-8 w-8 items-center justify-center rounded-[--radius-sm] text-text-muted transition-colors hover:bg-primary-bg hover:text-primary"
      aria-label={label}
    >
      <motion.svg
        key={setting}
        initial={{ rotate: -30, opacity: 0, scale: 0.8 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className="h-[18px] w-[18px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {setting === "system" ? (
          // Monitor icon for system/auto
          <>
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </>
        ) : resolved === "dark" ? (
          // Sun icon — clicking will go to system
          <>
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </>
        ) : (
          // Moon icon — clicking will go to dark
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        )}
      </motion.svg>
    </button>
  );
}
