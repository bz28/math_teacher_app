"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { subjectBreadcrumbJsonLd, subjectEducationalProgramJsonLd } from "@/lib/seo";
import { Section } from "./section";
import { Eyebrow } from "./eyebrow";
import { CtaBand } from "./cta-band";
import { FAQ as SharedFAQ } from "./faq";
import { StepsAnimation, type StepsAnimationData } from "./steps-animation";

interface ExampleProblem {
  topic: string;
  problem: string;
}

interface Feature {
  title: string;
  description: string;
}

interface SubjectFaq {
  question: string;
  answer: string;
}

interface SubjectPageProps {
  name: string;
  slug: "math" | "physics" | "chemistry";
  /** Short positioning phrase used in the headline accent */
  tagline: string;
  description: string;
  detailedDescription?: string;
  educationalProgramDescription: string;
  /** Unused with new design but kept for backward compat */
  gradient?: string;
  /** Hex used for inline subject pills — defaults to var(--color-primary) */
  badgeColor: string;
  icon: React.ReactNode;
  examples: ExampleProblem[];
  features: Feature[];
  /** Topics grid — what we cover for this subject */
  topics: string[];
  /** Subject-specific differentiators (distinct from generic examples/features) */
  differentiators: Feature[];
  /** 3 short reasons a teacher of this subject would want Veradic */
  whyReasons: string[];
  /** Subject-specific FAQ questions */
  subjectFaqs?: SubjectFaq[];
  /** Animated demo walkthrough — same component as the homepage hero */
  demoData?: StepsAnimationData;
}

export function SubjectPage({
  name,
  slug,
  tagline,
  description,
  detailedDescription,
  educationalProgramDescription,
  badgeColor,
  icon,
  topics,
  differentiators,
  whyReasons,
  demoData,
}: SubjectPageProps) {
  return (
    <div data-subject={slug === "math" ? undefined : slug}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(subjectBreadcrumbJsonLd(name, slug)),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            subjectEducationalProgramJsonLd(name, slug, educationalProgramDescription),
          ),
        }}
      />

      {/* ── Hero ── */}
      <section className="relative flex min-h-[calc(100dvh_-_4rem)] items-center overflow-hidden bg-[color:var(--color-surface)] md:min-h-[calc(100dvh_-_5rem)]">
        <div className="pointer-events-none absolute right-0 top-0 hidden h-[700px] w-[700px] rounded-full bg-gradient-to-br from-[color:var(--color-primary)]/12 to-transparent blur-3xl md:block" />
        <div className="pointer-events-none absolute -left-40 bottom-0 h-[460px] w-[460px] rounded-full bg-gradient-to-br from-[color:var(--color-primary-light)]/14 to-transparent blur-3xl" />

        <div className="relative mx-auto w-full max-w-4xl px-6 py-12 text-center md:px-8 md:py-16">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{
                backgroundColor: `${badgeColor}1a`,
                color: badgeColor,
              }}
            >
              {name}
            </span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.05 }}
            className="mx-auto mt-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-[color:var(--color-primary-bg)] text-[color:var(--color-primary)]"
            aria-hidden="true"
          >
            {icon}
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-8 text-display-xl text-[color:var(--color-text)]"
          >
            {tagline}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl"
          >
            {description}
          </motion.p>

          {detailedDescription && (
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-[color:var(--color-text-muted)]"
            >
              {detailedDescription}
            </motion.p>
          )}

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
          >
            <a
              href="#demo"
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[color:var(--color-primary)] px-8 text-base font-bold text-white transition-colors hover:bg-[color:var(--color-primary-dark)]"
            >
              Try a problem
            </a>
            <Link
              href="/teachers#contact"
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-8 text-base font-semibold text-[color:var(--color-text)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
            >
              Book a demo
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── Topics grid ── */}
      <Section variant="alt">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow>Topics we cover</Eyebrow>
          <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
            Everything your students see in class.
          </h2>
          <p className="mt-4 text-lg text-[color:var(--color-text-secondary)]">
            From the basics to the hardest problems on the AP exam. If it&rsquo;s
            in the {name.toLowerCase()} curriculum, Veradic can walk a student
            through it.
          </p>
        </div>

        <div className="mt-12 flex flex-wrap justify-center gap-3">
          {topics.map((topic) => (
            <span
              key={topic}
              className="rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] px-5 py-2.5 text-sm font-medium text-[color:var(--color-text-secondary)]"
            >
              {topic}
            </span>
          ))}
        </div>
      </Section>

      {/* ── Live demo — same animated component as the homepage hero ── */}
      {demoData && (
        <Section variant="invert" id="demo">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow variant="invert">See it solve a problem</Eyebrow>
            <h2 className="mt-6 text-display-md text-[color:var(--color-invert-text)]">
              Watch Veradic teach {name.toLowerCase()}.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-[color:var(--color-invert-text-muted)] md:text-xl">
              Not a glossy mockup. This is the real step-by-step output
              your students see when they work a problem.
            </p>
          </div>

          <div className="mx-auto mt-14 max-w-2xl">
            <StepsAnimation data={demoData} />
          </div>
        </Section>
      )}

      {/* ── Differentiators ── */}
      <Section variant="default">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow>Built for {name.toLowerCase()}</Eyebrow>
          <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
            Why Veradic fits the subject.
          </h2>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {differentiators.map((d, i) => (
            <div
              key={d.title}
              className="marketing-card rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] p-8"
            >
              <span className="text-xs font-semibold tracking-widest text-[color:var(--color-text-muted)]">
                0{i + 1}
              </span>
              <h3 className="mt-3 text-xl font-bold text-[color:var(--color-text)]">
                {d.title}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-[color:var(--color-text-secondary)]">
                {d.description}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Why for {name} teachers ── */}
      <Section variant="alt">
        <div className="mx-auto max-w-3xl">
          <Eyebrow>For {name.toLowerCase()} teachers</Eyebrow>
          <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
            Everything you wish your AI tool did.
          </h2>
          <ul className="mt-10 space-y-5">
            {whyReasons.map((reason) => (
              <li
                key={reason}
                className="flex items-start gap-4 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-6"
              >
                <svg
                  className="mt-1 h-6 w-6 flex-shrink-0 text-[color:var(--color-primary)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <p className="text-base leading-relaxed text-[color:var(--color-text-secondary)]">
                  {reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ── Shared homepage FAQ (always on) ── */}
      <SharedFAQ />

      {/* ── CTA band ── */}
      <CtaBand
        eyebrow="Ready when you are"
        headline={`Bring Veradic ${name} to your classroom.`}
        subhead="Book a 20-minute walkthrough. We'll show you exactly how it fits your curriculum."
      />
    </div>
  );
}
