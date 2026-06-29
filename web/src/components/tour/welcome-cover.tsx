"use client";

import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { TourCover } from "./types";

/** Split a headline into tokens, flagging the single *asterisk-wrapped*
 *  word so it can render in Fraunces italic. Trailing punctuation after
 *  the closing `*` (e.g. `*reimagined*.`) is kept OUTSIDE the italic as
 *  `suffix`, so the asterisks never render literally. */
function parseTitle(title: string): { text: string; italic: boolean; suffix: string }[] {
  return title.split(/\s+/).map((word) => {
    const m = /^\*(.+?)\*([^\w*]*)$/.exec(word);
    if (m) return { text: m[1], italic: true, suffix: m[2] };
    return { text: word, italic: false, suffix: "" };
  });
}

/**
 * Step 0 — the editorial welcome cover. The app sits dimmed behind a
 * 6px blur and cream veil; a centered composition introduces the tour
 * with a staggered word-reveal. Focus-trapped, role=dialog, Esc skips.
 */
export function WelcomeCover({
  cover,
  onTakeTour,
  onSkip,
}: {
  cover: TourCover;
  onTakeTour: () => void;
  onSkip: () => void;
}) {
  const reduce = useReducedMotion();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const words = parseTitle(cover.title);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => primaryRef.current?.focus());
    return () => {
      document.body.style.overflow = "";
      // Only pull focus back if it's STILL inside the cover at unmount.
      // AnimatePresence defers this unmount ~300ms — by which point the
      // spotlight has already focused its Next button, so focus has left
      // the panel. Restoring blindly would yank it back behind the scrim;
      // when the engine has moved it on, leave it where it landed.
      if (panel?.contains(document.activeElement)) {
        prevFocus?.focus();
      }
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onSkip();
      return;
    }
    if (e.key === "Tab" && panelRef.current) {
      const focusable = panelRef.current.querySelectorAll<HTMLElement>("button");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const containerVariants = {
    hidden: {},
    show: {
      transition: reduce ? {} : { staggerChildren: 0.045, delayChildren: 0.12 },
    },
  };
  const wordVariants = reduce
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: "0.4em", filter: "blur(4px)" },
        show: {
          opacity: 1,
          y: "0em",
          filter: "blur(0px)",
          transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
        },
      };

  return (
    <motion.div
      className="fixed inset-0 z-[55] flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to the Veradic tour"
      onKeyDown={onKeyDown}
      // Exit-animate the whole cover so it doesn't hard-cut to the
      // spotlight: the cream veil + composition recede (blur + slight
      // shrink) as the deep-green scrim washes in beneath it.
      initial={false}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.99, filter: "blur(2px)" }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* App dimmed behind a soft blur + cream veil. */}
      <motion.div
        className="absolute inset-0 backdrop-blur-[6px]"
        style={{ backgroundColor: "color-mix(in srgb, var(--color-bg) 78%, transparent)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
      />

      <motion.div
        ref={panelRef}
        className="relative w-full max-w-[34rem] text-center"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        <motion.p
          variants={wordVariants}
          className="font-mono text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--color-primary)]"
        >
          {cover.eyebrow}
        </motion.p>

        <h1 className="mt-5 font-serif text-[2.6rem] leading-[1.08] tracking-[-0.015em] text-text-primary sm:text-[3.1rem]">
          {words.map((w, i) => (
            <motion.span key={i} variants={wordVariants} className="inline-block">
              {w.italic ? (
                <>
                  <span className="font-display-serif italic text-[color:var(--color-primary)]">
                    {w.text}
                  </span>
                  {w.suffix}
                </>
              ) : (
                w.text
              )}
              {i < words.length - 1 ? " " : ""}
            </motion.span>
          ))}
        </h1>

        <motion.p
          variants={wordVariants}
          className="mx-auto mt-4 max-w-[26rem] font-serif text-[1.05rem] italic leading-relaxed text-text-secondary"
        >
          {cover.subtitle}
        </motion.p>

        <motion.div
          variants={wordVariants}
          className="mx-auto mt-7 h-px w-16 bg-border"
          aria-hidden
        />

        <motion.div
          variants={wordVariants}
          className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <button
            ref={primaryRef}
            type="button"
            onClick={onTakeTour}
            className="rounded-[--radius-pill] bg-primary px-7 py-2.5 text-sm font-semibold tracking-[0.01em] text-white shadow-sm transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {cover.cta}
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="rounded-[--radius-pill] px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {cover.skip}
          </button>
        </motion.div>

        <motion.p
          variants={wordVariants}
          className="mt-6 font-mono text-[11px] tracking-[0.04em] text-text-muted"
        >
          {cover.footnote}
        </motion.p>
      </motion.div>
    </motion.div>
  );
}
