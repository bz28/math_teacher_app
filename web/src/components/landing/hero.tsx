"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollY } = useScroll();
  const headlineY = useTransform(scrollY, [0, 500], [0, -50]);
  const subtitleY = useTransform(scrollY, [0, 500], [0, -30]);
  const pillsY = useTransform(scrollY, [0, 500], [0, -15]);
  const orbY = useTransform(scrollY, [0, 500], [0, 40]);
  const contentOpacity = useTransform(scrollY, [0, 400], [1, 0]);

  return (
    <section ref={sectionRef} className="relative overflow-hidden px-6 pb-20 pt-16 md:pb-28 md:pt-24">
      {/* Animated gradient mesh */}
      <motion.div style={{ y: orbY }} className="pointer-events-none absolute inset-0 -top-40 overflow-hidden">
        <motion.div
          className="absolute left-1/2 top-0 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-gradient-to-br from-primary/10 to-transparent blur-3xl"
          animate={{ x: [-20, 20, -20], y: [-10, 15, -10], scale: [1, 1.08, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute left-1/3 top-10 h-[400px] w-[400px] rounded-full bg-gradient-to-br from-primary-light/8 to-transparent blur-3xl"
          animate={{ x: [15, -25, 15], y: [10, -20, 10], scale: [1, 1.1, 1] }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute right-1/3 top-20 h-[350px] w-[350px] rounded-full bg-gradient-to-br from-success/5 to-transparent blur-3xl"
          animate={{ x: [-10, 30, -10], y: [-15, 10, -15], scale: [1, 1.05, 1] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>

      <motion.div style={{ opacity: contentOpacity }} className="relative mx-auto max-w-4xl text-center">
        {/* Pill badge */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-6 inline-flex items-center gap-2 rounded-[--radius-pill] border border-primary/20 bg-primary-bg px-4 py-1.5 text-sm font-semibold text-primary"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          AI-Powered Tutoring
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          style={{ y: headlineY }}
          className="text-5xl font-extrabold leading-tight tracking-tight text-text-primary md:text-6xl lg:text-7xl"
        >
          Snap. Learn.{" "}
          <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
            Master.
          </span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          style={{ y: subtitleY }}
          className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-text-secondary md:text-xl"
        >
          Your AI tutor that breaks any math or chemistry problem into steps you
          actually understand &mdash; then generates unlimited practice until you
          master it.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
        >
          <Link
            href="/register"
            className="inline-flex h-12 items-center gap-2 rounded-[--radius-pill] bg-gradient-to-r from-primary to-primary-light px-8 text-base font-bold text-white shadow-md transition-shadow hover:shadow-lg"
          >
            Get Started Free
            <ArrowRight />
          </Link>
          <a
            href="#how-it-works"
            className="inline-flex h-12 items-center gap-2 rounded-[--radius-pill] border border-border bg-surface px-8 text-base font-semibold text-text-secondary transition-colors hover:border-primary/30 hover:text-primary"
          >
            See How It Works
          </a>
        </motion.div>

        {/* Three feature pills */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
          style={{ y: pillsY }}
          className="mt-14 flex flex-wrap items-center justify-center gap-3"
        >
          <FeaturePill icon={<CameraIcon />} label="Snap a photo" />
          <FeaturePill icon={<BookIcon />} label="Learn steps" />
          <FeaturePill icon={<InfinityIcon />} label="Practice" />
        </motion.div>
      </motion.div>
    </section>
  );
}

function FeaturePill({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[--radius-pill] border border-border-light bg-surface px-4 py-2 text-sm font-medium text-text-secondary shadow-sm">
      <span className="text-primary">{icon}</span>
      {label}
    </div>
  );
}

function ArrowRight() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  );
}

function InfinityIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z" />
    </svg>
  );
}
