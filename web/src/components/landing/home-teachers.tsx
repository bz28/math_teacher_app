import type { ReactNode } from "react";
import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

type Feature = {
  title: string;
  body: string;
  icon: ReactNode;
};

const FEATURES: Feature[] = [
  {
    title: "Every student gets a personal tutor.",
    body: "Every student opens a problem and walks through it step by step, at their own pace. No one gets left behind, no one gets bored.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  {
    title: "See who's struggling — and who didn't do the work.",
    body: "Student sessions are tracked to your class, and Veradic's integrity checker verifies every homework submission. By Monday morning you know who needs help and who needs a conversation.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
        <path d="M11 8v6M8 11h6" />
      </svg>
    ),
  },
  {
    title: "Homework grades itself.",
    body: "Students photograph their work. Veradic drafts the grading step-by-step. You review, override where needed, and move on.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
  },
  {
    title: "Tests generated in seconds.",
    body: "Pick a topic. Veradic builds a test from your approved question bank, with answer keys and per-student variants so no two students get the same version.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
      </svg>
    ),
  },
];

export function HomeTeachers() {
  return (
    <Section variant="default">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>What you get back</Eyebrow>
        <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
          Reclaim your evenings.
        </h2>
        <p className="mt-6 text-xl leading-relaxed text-[color:var(--color-text-secondary)] md:text-[1.375rem]">
          You became a teacher to teach, not to photocopy worksheets at 9pm
          or grade the same multiple-choice quiz 140 times. Veradic handles
          the repetitive work so you can focus on what only a human can do.
        </p>
      </div>

      <div className="mt-14 grid gap-6 md:grid-cols-2 md:gap-8">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="marketing-card rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] p-8"
          >
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--color-primary-bg)] text-[color:var(--color-primary)]">
              <div className="h-6 w-6">{feature.icon}</div>
            </div>
            <h3 className="text-xl font-bold text-[color:var(--color-text)]">
              {feature.title}
            </h3>
            <p className="mt-3 text-base leading-relaxed text-[color:var(--color-text-secondary)]">
              {feature.body}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
