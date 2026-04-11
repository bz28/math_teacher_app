"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SUBJECT_CONFIG } from "@/lib/constants";
import type { Subject } from "@/stores/learn";
import { BookIcon, CheckIcon, DocIcon } from "@/components/ui/icons";

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
  const className = "h-14 w-14 text-white";
  if (mode === "test") return <DocIcon className={className} />;
  if (mode === "grading") return <CheckIcon className={className} strokeWidth={2} />;
  return <BookIcon className={className} />;
}
