"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const steps = [
  {
    number: "01",
    title: "Enter your problem",
    description:
      "Type it in or snap a photo of your worksheet. We'll extract every problem automatically.",
    color: "from-primary to-primary-light",
  },
  {
    number: "02",
    title: "AI breaks it into steps",
    description:
      "Our AI decomposes your problem into clear, ordered steps. No answer revealed until you work through each one.",
    color: "from-primary-light to-[#c4b5fd]",
  },
  {
    number: "03",
    title: "Learn with guided feedback",
    description:
      "Submit your answer at each step. Get instant feedback, ask follow-up questions, and build real understanding.",
    color: "from-success to-[#55EFC4]",
  },
  {
    number: "04",
    title: "Practice until you master it",
    description:
      "Generate unlimited similar problems. Track your progress, review flagged items, and watch your confidence grow.",
    color: "from-[#55EFC4] to-warning",
  },
];

export function HowItWorks() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="how-it-works" ref={ref} className="px-6 py-20 md:py-28">
      <div className="mx-auto max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
            How It Works
          </h2>
          <p className="mt-4 text-lg text-text-secondary">
            From problem to mastery in minutes
          </p>
        </motion.div>

        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-6 top-0 hidden h-full w-px bg-gradient-to-b from-primary via-success to-warning md:left-8 md:block" />

          <div className="space-y-10 md:space-y-14">
            {steps.map((step, i) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, x: -20 }}
                animate={inView ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: 0.15 * i, duration: 0.5 }}
                className="flex gap-5 md:gap-8"
              >
                {/* Step number bubble */}
                <div className="relative flex-shrink-0">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${step.color} text-sm font-extrabold text-white shadow-md md:h-16 md:w-16 md:text-base`}
                  >
                    {step.number}
                  </div>
                </div>

                {/* Content */}
                <div className="pt-1 md:pt-3">
                  <h3 className="text-lg font-bold text-text-primary md:text-xl">
                    {step.title}
                  </h3>
                  <p className="mt-2 leading-relaxed text-text-secondary">
                    {step.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
