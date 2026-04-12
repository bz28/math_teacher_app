"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Eyebrow } from "./eyebrow";

export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100dvh_-_4rem)] items-center overflow-hidden bg-[color:var(--color-surface)] md:min-h-[calc(100dvh_-_5rem)]">
      {/* Subtle radial glow */}
      <div className="pointer-events-none absolute right-0 top-1/4 hidden h-[720px] w-[720px] rounded-full bg-gradient-to-br from-[color:var(--color-primary)]/10 to-transparent blur-3xl md:block" />
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-gradient-to-br from-[color:var(--color-primary-light)]/10 to-transparent blur-3xl" />

      <div className="relative mx-auto w-full max-w-4xl px-6 py-12 text-center md:px-8 md:py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Eyebrow>Built for Classrooms</Eyebrow>

          <h1 className="mt-8 text-display-xl text-[color:var(--color-text)]">
            The AI tutor
            <br />
            that{" "}
            <span className="bg-gradient-to-r from-[color:var(--color-primary)] to-[color:var(--color-primary-light)] bg-clip-text text-transparent">
              teaches,
            </span>
            <br />
            instead of telling.
          </h1>

          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
            Veradic walks every student through the reasoning, step by step,
            until they get there themselves. Built for teachers, loved by
            students.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/demo"
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
              href="#demo"
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-8 text-base font-semibold text-[color:var(--color-text-secondary)] transition-colors hover:border-[color:var(--color-primary)]/40 hover:text-[color:var(--color-primary)]"
            >
              See how it works
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
