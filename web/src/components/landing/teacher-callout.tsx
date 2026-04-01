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
        className="relative mx-auto max-w-4xl overflow-hidden rounded-[--radius-xl] bg-gradient-to-br from-primary to-primary-light p-10 shadow-lg sm:p-12"
      >
        {/* Decorative circles */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-white/5" />

        <div className="relative flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-start gap-4">
            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-[--radius-lg] bg-white/15 sm:flex">
              <svg className="h-7 w-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
                Are you a teacher?
              </h3>
              <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-white/80">
                See how Veradic AI works in your classroom — manage courses,
                track student progress, and let AI handle the repetitive tutoring.
              </p>
            </div>
          </div>
          <Link
            href="/teachers"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-[--radius-pill] bg-white px-6 text-sm font-bold text-primary shadow-md transition-all hover:scale-[1.02] hover:shadow-lg"
          >
            Learn More
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
