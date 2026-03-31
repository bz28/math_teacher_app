"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const features = [
  {
    title: "Step-by-Step Learning",
    description:
      "Every problem is broken into clear, guided steps. The final answer stays hidden until you've worked through each one.",
    icon: StepsIcon,
  },
  {
    title: "Chat With Your Tutor",
    description:
      "Stuck on a step? Ask a question and get a personalized explanation without revealing future steps or answers.",
    icon: ChatIcon,
  },
  {
    title: "Work Diagnosis",
    description:
      "Upload a photo of your handwritten work. AI analyzes each step against the optimal solution and pinpoints errors.",
    icon: DiagnosisIcon,
  },
  {
    title: "Unlimited Practice",
    description:
      "Generate as many similar problems as you need. Each one comes with its own answer for instant self-checking.",
    icon: PracticeIcon,
  },
  {
    title: "Mock Exams",
    description:
      "Simulate a real test with a timer, free navigation, and comprehensive results review when you're done.",
    icon: ExamIcon,
  },
  {
    title: "Session History",
    description:
      "Review past sessions anytime. Resume where you left off or replay completed solutions step by step.",
    icon: HistoryIcon,
  },
];

export function Features() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="features"
      ref={ref}
      className="bg-gradient-to-b from-transparent via-primary-bg/30 to-transparent px-6 py-20 md:py-28"
    >
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
            Everything You Need to Master Any Problem
          </h2>
          <p className="mt-4 text-lg text-text-secondary">
            Powerful features designed for real understanding, not just answers
          </p>
        </motion.div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.08 * i, duration: 0.5 }}
              className="group rounded-[--radius-xl] border border-border-light bg-surface p-6 transition-all hover:border-primary/20 hover:shadow-md"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[--radius-md] bg-primary-bg text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                <feature.icon />
              </div>
              <h3 className="text-base font-bold text-text-primary">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StepsIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M2 12h20" />
      <path d="M2 7h6M2 17h6M16 7h6M16 17h6" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function DiagnosisIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function PracticeIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z" />
    </svg>
  );
}

function ExamIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}
