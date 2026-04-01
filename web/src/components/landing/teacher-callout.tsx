"use client";

import Link from "next/link";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";

export function TeacherCallout() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="px-6 pb-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
        className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-6 rounded-[--radius-xl] border border-border-light bg-surface p-8 sm:flex-row sm:p-10"
      >
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-[--radius-pill] bg-primary-bg px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
            For Schools
          </div>
          <h3 className="text-xl font-extrabold tracking-tight text-text-primary sm:text-2xl">
            Are you a teacher?
          </h3>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-text-secondary">
            See how Veradic AI works in your classroom — manage courses,
            track student progress, and let AI handle the repetitive tutoring.
          </p>
        </div>
        <Link
          href="/teachers"
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-[--radius-pill] border-2 border-primary px-6 text-sm font-bold text-primary transition-colors hover:bg-primary hover:text-white"
        >
          Learn More
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </motion.div>
    </section>
  );
}
