"use client";

import Link from "next/link";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";

export function CTA() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="px-6 py-20 md:py-28">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6 }}
        className="mx-auto max-w-3xl rounded-[--radius-xl] bg-gradient-to-br from-primary to-primary-light p-10 text-center shadow-lg md:p-16"
      >
        <h2 className="text-3xl font-extrabold text-white md:text-4xl">
          Ready to actually understand math?
        </h2>
        <p className="mt-4 text-lg text-white/80">
          Join students who are mastering problems step by step.
        </p>
        <Link
          href="/register"
          className="mt-8 inline-flex h-12 items-center gap-2 rounded-[--radius-pill] bg-white px-8 text-base font-bold text-primary shadow-md transition-all hover:shadow-lg hover:scale-[1.02]"
        >
          Get Started Free
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </motion.div>
    </section>
  );
}
