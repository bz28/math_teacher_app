"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const subjects = [
  {
    name: "Mathematics",
    description: "Algebra, equations, word problems, and more",
    gradient: "from-primary to-primary-light",
    icon: MathIcon,
  },
  {
    name: "Chemistry",
    description: "Reactions, balancing equations, stoichiometry, and more",
    gradient: "from-success to-[#55EFC4]",
    icon: ChemIcon,
  },
];

export function Subjects() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section id="subjects" ref={ref} className="px-6 py-20 md:py-28">
      <div className="mx-auto max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
            Pick Your Subject
          </h2>
          <p className="mt-4 text-lg text-text-secondary">
            More subjects coming soon
          </p>
        </motion.div>

        <div className="grid gap-6 sm:grid-cols-2">
          {subjects.map((subject, i) => (
            <motion.div
              key={subject.name}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.15 * i, duration: 0.5 }}
              className="group relative overflow-hidden rounded-[--radius-xl] border border-border-light bg-surface p-8 transition-all hover:shadow-lg"
            >
              {/* Gradient accent bar */}
              <div
                className={`absolute left-0 top-0 h-1 w-full bg-gradient-to-r ${subject.gradient}`}
              />

              <div
                className={`mb-5 flex h-14 w-14 items-center justify-center rounded-[--radius-lg] bg-gradient-to-br ${subject.gradient} text-white shadow-md`}
              >
                <subject.icon />
              </div>

              <h3 className="text-xl font-bold text-text-primary">
                {subject.name}
              </h3>
              <p className="mt-2 text-text-secondary">{subject.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MathIcon() {
  return (
    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
    </svg>
  );
}

function ChemIcon() {
  return (
    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6v7l4 9H5l4-9V3z" />
      <line x1="9" y1="3" x2="15" y2="3" />
    </svg>
  );
}
