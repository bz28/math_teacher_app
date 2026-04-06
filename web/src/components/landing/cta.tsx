"use client";

import Link from "next/link";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";

export function CTA() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="px-6 py-24 md:py-32">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
        className="mx-auto max-w-2xl"
      >
        {/* Gradient border card */}
        <div className="rounded-[--radius-xl] bg-gradient-to-br from-primary to-primary-light p-px shadow-lg">
          <div className="rounded-[--radius-xl] bg-surface px-8 py-12 text-center md:px-12 md:py-16">
            <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
              Start mastering your next topic
            </h2>
            <p className="mt-3 text-lg text-text-secondary">
              Join students who are learning step by step. Free to start — no credit card needed.
            </p>

            <Link
              href="/register"
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-[--radius-pill] bg-primary px-8 text-base font-bold text-white transition-colors hover:bg-primary-dark"
            >
              Create Your Account
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>

            <p className="mt-8 text-sm text-text-muted">
              Are you a teacher?{" "}
              <Link
                href="/teachers"
                className="font-semibold text-primary transition-colors hover:text-primary-dark"
              >
                See how Veradic works in your classroom &rarr;
              </Link>
            </p>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
