"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { BrowserFrame } from "./product-mockup";
import { AnimatedLearnDemo } from "./animated-demo";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-primary-bg/40 via-transparent to-transparent px-6 pb-20 pt-14 md:pb-28 md:pt-20">
      {/* Subtle radial glow */}
      <div className="pointer-events-none absolute left-1/2 top-1/3 hidden h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-gradient-to-br from-primary/8 to-transparent blur-3xl md:block" />

      <div className="relative mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="mb-5 inline-flex items-center gap-2 rounded-[--radius-pill] border border-primary/20 bg-primary-bg px-4 py-1.5 text-sm font-semibold text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            AI-Powered Tutoring
          </div>

          <h1 className="text-4xl font-black leading-[1.1] tracking-tight text-text-primary sm:text-5xl lg:text-6xl">
            Snap. Learn.{" "}
            <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
              Master.
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-text-secondary">
            Veradic — your personal AI tutor that breaks any math or science
            problem into steps you actually understand.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/register"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[--radius-pill] bg-primary px-7 text-base font-bold text-white transition-colors hover:bg-primary-dark"
            >
              Try It Free
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <a
              href="#features"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[--radius-pill] border border-border bg-surface px-7 text-base font-semibold text-text-secondary transition-colors hover:border-primary/30 hover:text-primary"
            >
              See how it works
            </a>
          </div>
        </motion.div>

        {/* Product mockup — centered below CTA */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-14 md:mt-16"
        >
          <BrowserFrame>
            <AnimatedLearnDemo />
          </BrowserFrame>
        </motion.div>
      </div>
    </section>
  );
}
