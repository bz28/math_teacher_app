"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SUBJECT_CONFIG } from "@/lib/constants";
import type { Subject } from "@/stores/learn";

type Mode = "learn" | "test" | "grading";

const PHRASES: Record<Mode, string[]> = {
  learn: [
    "Reading the problem…",
    "Working through it…",
    "Building your steps…",
    "Almost ready…",
  ],
  test: [
    "Setting up your exam…",
    "Generating questions…",
    "Picking the best problems…",
    "Almost ready…",
  ],
  grading: [
    "Grading your answers…",
    "Checking the details…",
    "Almost there…",
  ],
};

const TITLES: Record<Mode, string> = {
  learn: "Building your session",
  test: "Setting up your exam",
  grading: "Grading your answers",
};

/**
 * Full-screen loading state with a pulsing subject-gradient hero and a
 * rotating subtitle phrase. Mirrors mobile `LoadingHero`.
 *
 * Used in place of a generic spinner anywhere session generation / mock-test
 * setup / mock-test grading is in flight.
 */
export function LoadingHero(props: { subject?: Subject; mode: Mode }) {
  // Keying by mode forces a full remount when the mode changes (e.g. a page
  // transitions from "test" setup to "grading"), so phrase rotation restarts
  // cleanly from phrase 0 without setState-in-effect.
  return <LoadingHeroInner key={props.mode} {...props} />;
}

function LoadingHeroInner({
  subject = "math",
  mode,
}: {
  subject?: Subject;
  mode: Mode;
}) {
  const phrases = PHRASES[mode];
  const gradient = SUBJECT_CONFIG[subject]?.gradient ?? "bg-gradient-primary";
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setPhraseIdx((i) => (i >= phrases.length - 1 ? i : i + 1));
    }, 2400);
    return () => clearInterval(t);
  }, [phrases.length]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center px-6",
        gradient,
      )}
      role="status"
      aria-live="polite"
    >
      <motion.div
        initial={{ scale: 1, opacity: 0.6 }}
        animate={{ scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        className="mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-white/20"
      >
        <ModeIcon mode={mode} />
      </motion.div>
      <h2 className="mb-2 text-center text-2xl font-bold text-white">
        {TITLES[mode]}
      </h2>
      <p className="text-center text-[15px] text-white/90">{phrases[phraseIdx]}</p>
    </div>
  );
}

function ModeIcon({ mode }: { mode: Mode }) {
  if (mode === "test") {
    return (
      <svg
        className="h-14 w-14 text-white"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    );
  }
  if (mode === "grading") {
    return (
      <svg
        className="h-14 w-14 text-white"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    );
  }
  return (
    <svg
      className="h-14 w-14 text-white"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  );
}
