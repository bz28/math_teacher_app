"use client";

import Link from "next/link";
import { motion, MotionConfig } from "framer-motion";

const EASE = [0.22, 1, 0.36, 1] as const;
const rise = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100dvh_-_4rem)] items-center overflow-hidden bg-[color:var(--color-surface)] md:min-h-[calc(100dvh_-_5rem)]">
      {/* Hairline V-mark, bottom-right. Breathes slowly — subliminal life
          under an otherwise still editorial hero. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-12 -right-8 select-none text-[color:var(--color-primary)] md:-bottom-24 md:-right-4"
        initial={{ opacity: 0.05, scale: 1 }}
        animate={{ opacity: [0.05, 0.075, 0.05], scale: [1, 1.025, 1] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg width="640" height="640" viewBox="0 0 512 512" fill="none" className="h-[12rem] w-[12rem] md:h-[22rem] md:w-[22rem]">
          <path d="M120 100 L256 412 L392 100" stroke="currentColor" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.div>

      <MotionConfig reducedMotion="user">
        <motion.div
          className="relative mx-auto w-full max-w-5xl px-6 py-12 text-center md:px-8 md:py-16"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } } }}
        >
          {/* Both lines are the display serif. The setup line was set in
              Inter Bold while the payoff was Fraunces italic — one
              sentence, two typefaces, and the break landed exactly
              where the argument turns, so the turn read as a font
              change rather than a thought. Now the face is constant
              and roman→italic carries the pivot, which is what italic
              is for. Tracking eased from -0.025em: that was tuned for
              Inter and collides Fraunces' terminals at 4.75rem. */}
          <h1 className="font-display-serif tracking-[-0.02em] text-[color:var(--color-text)] [font-size:clamp(2.75rem,5.8vw,4.75rem)] [line-height:1.08] [text-wrap:balance]">
            <motion.span className="block font-semibold pb-2" variants={rise}>
              Your students already have AI.
            </motion.span>
            <motion.span className="block font-display-serif italic font-semibold pb-2 text-[color:var(--color-primary)] [font-size:1.2em]" variants={rise}>
              Give them one that&rsquo;s on your side.
            </motion.span>
          </h1>
          <motion.p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl" variants={rise}>
            See who actually understands &mdash; not just who got the right
            answer. Veradic checks real understanding, drafts every grade for
            your approval, and writes next week&rsquo;s homework &mdash; before
            you leave the building.
          </motion.p>

          <motion.div className="mt-10 flex flex-col items-center gap-4" variants={rise}>
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
              <Link
                href="/demo"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[--radius-pill] bg-[color:var(--color-primary)] px-8 text-[15px] font-semibold tracking-[0.01em] text-white transition-colors hover:bg-[color:var(--color-primary-dark)]"
              >
                Book a demo
                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
              <a
                href="#integrity"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[--radius-pill] border border-[color:var(--color-border)] bg-transparent px-8 text-[15px] font-semibold tracking-[0.01em] text-[color:var(--color-text)] transition-colors hover:border-[color:var(--color-text)]"
              >
                See it check who really understands
                <span aria-hidden="true">&darr;</span>
              </a>
            </div>
            <p className="text-xs font-medium text-[color:var(--color-text-secondary)]">
              Built for teachers &middot; Sold to schools
            </p>
          </motion.div>
        </motion.div>
      </MotionConfig>
    </section>
  );
}
