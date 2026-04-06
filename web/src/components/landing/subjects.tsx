"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";

const subjects = [
  {
    name: "Math",
    description: "Algebra, calculus, geometry, word problems, and more",
    href: "/subjects/math",
    gradient: "from-primary to-primary-light",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
      </svg>
    ),
  },
  {
    name: "Physics",
    description: "Mechanics, energy, waves, thermodynamics, and more",
    href: "/subjects/physics",
    gradient: "from-[#0984E3] to-[#74B9FF]",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      </svg>
    ),
  },
  {
    name: "Chemistry",
    description: "Reactions, stoichiometry, organic chemistry, and more",
    href: "/subjects/chemistry",
    gradient: "from-success to-[#55EFC4]",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3h6v7l4 9H5l4-9V3z" />
        <line x1="9" y1="3" x2="15" y2="3" />
      </svg>
    ),
  },
];

export function Subjects() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section id="subjects" ref={ref} className="bg-bg-secondary px-6 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
            Pick Your Subject
          </h2>
          <p className="mt-3 text-lg text-text-secondary">
            Math, Physics, Chemistry on Veradic — more coming soon
          </p>
        </motion.div>

        <div className="grid gap-5 sm:grid-cols-3">
          {subjects.map((subject, i) => (
            <motion.div
              key={subject.name}
              initial={{ opacity: 0, y: 16 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.1 * i, duration: 0.4 }}
            >
              <Link
                href={subject.href}
                className="group relative block overflow-hidden rounded-[--radius-lg] border border-border-light bg-surface p-6 transition-all hover:border-primary/20 hover:shadow-lg"
              >
                {/* Subtle subject-colored tint */}
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${subject.gradient} opacity-[0.04] transition-opacity group-hover:opacity-[0.08]`} />
                <div className="relative">
                  <div
                    className={`mb-4 flex h-14 w-14 items-center justify-center rounded-[--radius-lg] bg-gradient-to-br ${subject.gradient} text-white shadow-sm`}
                    aria-hidden="true"
                  >
                    {subject.icon}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-lg font-bold text-text-primary group-hover:text-primary transition-colors">
                      {subject.name}
                    </p>
                    <svg className="h-4 w-4 text-text-muted opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                    {subject.description}
                  </p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
