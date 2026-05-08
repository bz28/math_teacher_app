"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion,
  MotionConfig,
  useInView,
  useReducedMotion,
} from "framer-motion";

export type IntegrityVerdict = "FLAGGED" | "REVIEW" | "PASSED";

export interface IntegrityReviewCardProps {
  studentName: string;
  /** e.g. "Algebra II · Period 3" — class + period label.
   *  Named periodLabel rather than `className` to avoid shadowing
   *  React's CSS class convention. */
  periodLabel: string;
  /** e.g. "Problem set 4 — Trigonometric identities" */
  assignmentTitle: string;
  /** e.g. "2 hours ago" */
  submittedAgo: string;
  /** 0-100 — the integrity score the AI surfaces to the teacher. */
  score: number;
  verdict: IntegrityVerdict;
  /** The italicized one-line verdict from the AI. */
  headline: string;
  /** 2-3 short pulled quotes from the conversation. */
  evidenceBullets: string[];
}

/**
 * The Integrity Review card — the page's signature designed artifact.
 * Renders as a polished mock of what a teacher sees in their
 * submissions queue after Veradic runs the conversational integrity
 * check on a homework submission. Every other element on the page is
 * type-only or a plain product screenshot; this one is the page's
 * single choreographed moment.
 *
 * The card is purely presentational and non-interactive on the
 * marketing site — the [See full conversation] and [Override score]
 * buttons are visual evidence of the teacher's authority over the
 * AI's draft, not real actions. Anyone clicking them on the marketing
 * page is already past the point of being persuaded by the page.
 *
 * Reduced-motion handling is delegated to MotionConfig — framer-motion
 * collapses durations to 0 transparently, so the JSX tree (and SSR
 * output) stays identical regardless of user preference. The local
 * useReducedMotion is used only to short-circuit the imperative RAF
 * count-up loop, which lives outside framer-motion.
 */
export function IntegrityReviewCard(props: IntegrityReviewCardProps) {
  const {
    studentName,
    periodLabel,
    assignmentTitle,
    submittedAgo,
    score,
    verdict,
    headline,
    evidenceBullets,
  } = props;

  const ref = useRef<HTMLDivElement>(null);
  // Trigger the entrance animation once when 60% of the card is in
  // view. `once: true` so re-scrolling past the card later doesn't
  // re-fire the choreography.
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reducedMotion = useReducedMotion();

  // Animated count-up. State starts at 0 on both server and client so
  // initial render matches; the RAF loop only mutates after mount.
  const [animatedScore, setAnimatedScore] = useState(0);
  useEffect(() => {
    if (!inView || reducedMotion) return;
    const startedAt = performance.now();
    const startDelay = 360; // ms — sync with bar fill that starts at 320ms
    const duration = 560;
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - startedAt - startDelay;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const progress = Math.min(1, elapsed / duration);
      // ease-out cubic — matches the bar fill curve so they read as
      // a single coordinated motion, not two parallel animations.
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedScore(Math.round(eased * score));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, score, reducedMotion]);

  // Reduced-motion users (and the SSR/first-paint moment, where
  // useReducedMotion returns null) want the score visible immediately
  // once the card is in frame, without a count-up.
  const displayScore = reducedMotion && inView ? score : animatedScore;

  // Fill color depends on the score band. <50 reads as a clear flag,
  // 50-69 reads as needs-review, ≥70 reads as passed cleanly.
  const fillToken =
    score < 50
      ? "var(--color-error)"
      : score < 70
      ? "var(--color-warning-dark)"
      : "var(--color-success)";

  const verdictStyles: Record<IntegrityVerdict, { bg: string; fg: string }> = {
    FLAGGED: { bg: "var(--color-error-light)", fg: "var(--color-error)" },
    REVIEW: { bg: "var(--color-warning-bg)", fg: "var(--color-warning-dark)" },
    PASSED: { bg: "var(--color-success-light)", fg: "var(--color-success)" },
  };
  const verdictLabel = verdictStyles[verdict];

  return (
    // MotionConfig with reducedMotion="user" delegates to framer-motion:
    // when the user prefers reduced motion, durations collapse to 0
    // automatically without us having to branch the JSX. SSR output is
    // identical for both preferences, which avoids hydration drift.
    <MotionConfig reducedMotion="user">
      <motion.div
        ref={ref}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
        className="relative mx-auto w-full max-w-[640px]"
      >
        <div
          className="overflow-hidden rounded-[--radius-xl] border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] shadow-[0_24px_60px_-20px_rgba(14,82,56,0.18),0_8px_24px_-8px_rgba(14,82,56,0.12)]"
          role="figure"
          aria-label={`Submission review for ${studentName}, integrity score ${score} percent, verdict ${verdict.toLowerCase()}`}
        >
          {/* ── Header strip — document-style metadata. Uses uppercase tracking
              to read like a printed report header, not an app row. */}
          <FadeIn delay={0.12} inView={inView}>
            <div className="border-b border-[color:var(--color-border-light)] px-7 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-muted)]">
                Submission review · {periodLabel}
              </div>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="text-base font-semibold text-[color:var(--color-text)]">
                  {studentName}
                  <span className="ml-2 text-sm font-normal text-[color:var(--color-text-secondary)]">
                    · {assignmentTitle}
                  </span>
                </div>
                <div className="text-xs text-[color:var(--color-text-muted)]">
                  submitted {submittedAgo}
                </div>
              </div>
            </div>
          </FadeIn>

          <div className="space-y-7 px-7 py-7">
            {/* ── Score block ── */}
            <div>
              <FadeIn delay={0.24} inView={inView}>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--color-text-muted)]">
                    Integrity score
                  </div>
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.2, delay: 0.4 }}
                    className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]"
                    style={{
                      backgroundColor: verdictLabel.bg,
                      color: verdictLabel.fg,
                    }}
                  >
                    {verdict}
                  </motion.span>
                </div>
              </FadeIn>

              {/* Big score number — Fraunces serif. The display utility
                  class picks up Fraunces via globals.css; size renders
                  per the text-display-md clamp (max 48px). No aria-live
                  on the count-up — the parent figure's aria-label
                  already announces the final score, so a live region
                  here would noisily duplicate intermediate values. */}
              <div className="mt-2 text-display-md font-bold text-[color:var(--color-text)]">
                <span>{displayScore}</span>
                <span className="text-[color:var(--color-text-muted)]">%</span>
              </div>

              {/* Score bar */}
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[color:var(--color-border-light)]">
                <motion.div
                  initial={{ width: 0 }}
                  animate={inView ? { width: `${score}%` } : { width: 0 }}
                  transition={{
                    duration: 0.56,
                    delay: 0.32,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: fillToken }}
                />
              </div>
            </div>

            {/* ── Headline (italic serif verdict) ── */}
            <FadeIn delay={0.88} inView={inView}>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--color-text-muted)]">
                  Headline
                </div>
                {/* Fraunces italic via the display utility — letterform
                    is what makes this read as an academic verdict, not
                    a chat snippet. Curly quotes intentional. The italic
                    face is loaded explicitly in layout.tsx so the
                    browser doesn't fall back to a synthesized slant. */}
                <p className="mt-2 text-display-sm italic leading-snug text-[color:var(--color-text)]">
                  &ldquo;{headline}&rdquo;
                </p>
              </div>
            </FadeIn>

            {/* ── Evidence bullets ── */}
            <div>
              <FadeIn delay={1.0} inView={inView}>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--color-text-muted)]">
                  Key moments from the conversation
                </div>
              </FadeIn>
              <ul className="mt-3 space-y-2">
                {evidenceBullets.map((b, i) => (
                  <FadeIn key={b} delay={1.12 + i * 0.18} inView={inView}>
                    <li className="flex items-start gap-3 text-[15px] leading-relaxed text-[color:var(--color-text-secondary)]">
                      <span
                        aria-hidden="true"
                        className="mt-2 inline-block h-1 w-3 shrink-0 rounded-full bg-[color:var(--color-primary-light)]"
                      />
                      <span>{b}</span>
                    </li>
                  </FadeIn>
                ))}
              </ul>
            </div>
          </div>

          {/* ── Footer actions — visible-but-non-interactive. They show
              the teacher their actual workflow (final authority over
              the AI's draft), but tabbing into them on the marketing
              page does nothing. */}
          <FadeIn delay={1.5} inView={inView}>
            <div className="flex items-center justify-between gap-3 border-t border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] px-7 py-4">
              <div className="text-sm font-semibold text-[color:var(--color-primary)]">
                See full conversation →
              </div>
              <div className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-sm font-semibold text-[color:var(--color-text)]">
                Override score
              </div>
            </div>
          </FadeIn>
        </div>
      </motion.div>
    </MotionConfig>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Tiny fade-in wrapper. Always returns a motion.div — no conditional
   reduced-motion branch here, because that would diverge SSR/CSR DOM
   structure for users with prefers-reduced-motion. The MotionConfig
   above strips the actual animation when needed; the wrapper is a
   no-op layout div in that case.
   ────────────────────────────────────────────────────────────────── */
function FadeIn({
  children,
  delay,
  inView,
}: {
  children: React.ReactNode;
  delay: number;
  inView: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
      transition={{ duration: 0.24, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
