"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import {
  BrowserFrame,
  StepTimelineMockup,
  ChatMockup,
  PracticeMockup,
} from "./product-mockup";

/* ── Main feature rows ── */
const rows = [
  {
    id: "step-by-step",
    title: "Step-by-Step Learning",
    description:
      "Every problem is broken into clear, guided steps. The final answer stays hidden until you've worked through each one — building real understanding, not just copying answers.",
    Mockup: StepTimelineMockup,
  },
  {
    id: "chat-tutor",
    title: "Chat With Your Tutor",
    description:
      "Stuck on a step? Ask a question and get a personalized explanation — without revealing future steps or answers. Like having a tutor who meets you exactly where you are.",
    Mockup: ChatMockup,
  },
  {
    id: "practice",
    title: "Unlimited Practice",
    description:
      "Generate unlimited similar problems with instant feedback on every answer. Track your progress, review what you got wrong, and keep practicing until it clicks.",
    Mockup: PracticeMockup,
  },
];

/* ── Secondary features ── */
const secondary = [
  {
    icon: DiagnosisIcon,
    label: "Work Diagnosis",
    desc: "Upload your handwritten work — AI pinpoints errors step by step",
  },
  {
    icon: ExamIcon,
    label: "Mock Exams",
    desc: "Simulate a real test with a timer and full results review",
  },
  {
    icon: HistoryIcon,
    label: "Session History",
    desc: "Review past sessions anytime — resume or replay step by step",
  },
];

export function Features() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section id="features" ref={ref} className="px-6 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-20 text-center"
        >
          <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
            Everything You Need to Master Any Topic
          </h2>
          <p className="mt-3 text-lg text-text-secondary">
            Powerful features designed for real understanding, not just answers
          </p>
        </motion.div>

        {/* Alternating rows */}
        <div className="space-y-24 md:space-y-32">
          {rows.map((row, i) => (
            <FeatureRow
              key={row.title}
              id={row.id}
              title={row.title}
              description={row.description}
              Mockup={row.Mockup}
              reverse={i % 2 === 1}
            />
          ))}
        </div>

        {/* Secondary features strip */}
        <SecondaryStrip />
      </div>
    </section>
  );
}

/* ── Secondary features strip ── */
function SecondaryStrip() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5 }}
      className="mt-24 pt-12"
    >
      <p className="mb-8 text-center text-lg font-bold text-text-primary">
        And more
      </p>
      <div className="grid gap-5 sm:grid-cols-3">
        {secondary.map((item) => (
          <div
            key={item.label}
            className="rounded-[--radius-lg] border border-border-light bg-surface p-5 transition-all hover:border-primary/20 hover:shadow-sm"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[--radius-md] bg-primary-bg text-primary">
              <item.icon />
            </div>
            <p className="text-sm font-bold text-text-primary">
              {item.label}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{item.desc}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ── Feature Row ── */
function FeatureRow({
  id,
  title,
  description,
  Mockup,
  reverse,
}: {
  id: string;
  title: string;
  description: string;
  Mockup: React.ComponentType;
  reverse: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      id={id}
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="scroll-mt-24 grid items-center gap-10 md:grid-cols-2 md:gap-16"
    >
      {/* Text */}
      <div className={reverse ? "md:order-2" : ""}>
        <h3 className="text-2xl font-bold tracking-tight text-text-primary md:text-3xl">
          {title}
        </h3>
        <p className="mt-4 leading-relaxed text-text-secondary">
          {description}
        </p>
      </div>

      {/* Mockup */}
      <div className={reverse ? "md:order-1" : ""}>
        <BrowserFrame>
          <Mockup />
        </BrowserFrame>
      </div>
    </motion.div>
  );
}

/* ── Icons ── */
function DiagnosisIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function ExamIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}
