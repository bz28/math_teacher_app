"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const stats = [
  { value: "10,000+", label: "Problems solved" },
  { value: "500+", label: "Students learning" },
  { value: "3", label: "Subjects supported" },
];

export function SocialProof() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section ref={ref} className="border-y border-border-light bg-card/50 px-6 py-14 md:py-16">
      <div className="mx-auto max-w-4xl">
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4 }}
          className="mb-6 text-center text-sm font-semibold text-text-muted"
        >
          Students love learning with Veradic
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center justify-center gap-8 sm:flex-row sm:gap-16 md:gap-20"
        >
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.1 * i, duration: 0.4 }}
              className="text-center"
            >
              <p className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
                {stat.value}
              </p>
              <p className="mt-1 text-sm text-text-secondary">{stat.label}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
