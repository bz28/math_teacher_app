"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Eyebrow } from "./eyebrow";
import { StepsAnimation } from "./steps-animation";
import { mathDemo } from "./demos/math-demo";

export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100dvh_-_4rem)] items-center overflow-hidden bg-[color:var(--color-surface)] md:min-h-[calc(100dvh_-_5rem)]">
      {/* Subtle radial glow */}
      <div className="pointer-events-none absolute right-0 top-1/4 hidden h-[720px] w-[720px] rounded-full bg-gradient-to-br from-[color:var(--color-primary)]/10 to-transparent blur-3xl md:block" />
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-gradient-to-br from-[color:var(--color-primary-light)]/10 to-transparent blur-3xl" />

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-14 px-6 py-12 md:grid-cols-[1.1fr_1fr] md:gap-12 md:px-8 md:py-16">
        {/* Left — text */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Eyebrow>Built for Classrooms</Eyebrow>

          <h1 className="mt-6 text-display-xl text-[color:var(--color-text)]">
            The AI tutor
            <br />
            that{" "}
            <span className="bg-gradient-to-r from-[color:var(--color-primary)] to-[color:var(--color-primary-light)] bg-clip-text text-transparent">
              teaches,
            </span>
            <br />
            instead of telling.
          </h1>

          <p className="mt-7 max-w-xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
            Veradic walks every student through the thinking, question by
            question, step by step, until they get there themselves. Built for
            schools, loved by teachers.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/teachers#contact"
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[color:var(--color-primary)] px-8 text-base font-bold text-white transition-colors hover:bg-[color:var(--color-primary-dark)]"
            >
              Book a demo
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-8 text-base font-semibold text-[color:var(--color-text-secondary)] transition-colors hover:border-[color:var(--color-primary)]/40 hover:text-[color:var(--color-primary)]"
            >
              See how it works
            </a>
          </div>

          <p className="mt-6 text-sm text-[color:var(--color-text-muted)]">
            Looking for the student app?{" "}
            <Link
              href="/students"
              className="font-semibold text-[color:var(--color-primary)] underline-offset-4 hover:underline"
            >
              Head over here →
            </Link>
          </p>
        </motion.div>

        {/* Right — animated step-by-step walkthrough */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative"
        >
          <StepsAnimation data={mathDemo} hideQuestions />
        </motion.div>
      </div>
    </section>
  );
}
