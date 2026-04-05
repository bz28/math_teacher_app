"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";
import { subjectBreadcrumbJsonLd, subjectEducationalProgramJsonLd } from "@/lib/seo";

const ALL_SUBJECTS = [
  {
    name: "Math",
    href: "/subjects/math",
    gradient: "from-primary to-primary-light",
    description: "Algebra, calculus, geometry, and more",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
      </svg>
    ),
  },
  {
    name: "Physics",
    href: "/subjects/physics",
    gradient: "from-[#0984E3] to-[#74B9FF]",
    description: "Mechanics, energy, waves, and more",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      </svg>
    ),
  },
  {
    name: "Chemistry",
    href: "/subjects/chemistry",
    gradient: "from-success to-[#55EFC4]",
    description: "Reactions, stoichiometry, and more",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3h6v7l4 9H5l4-9V3z" />
        <line x1="9" y1="3" x2="15" y2="3" />
      </svg>
    ),
  },
];

interface ExampleProblem {
  topic: string;
  problem: string;
}

interface Feature {
  title: string;
  description: string;
}

interface SubjectPageProps {
  name: string;
  slug: string;
  tagline: string;
  description: string;
  detailedDescription?: string;
  educationalProgramDescription: string;
  gradient: string;
  badgeColor: string;
  icon: React.ReactNode;
  examples: ExampleProblem[];
  features: Feature[];
}

export function SubjectPage({
  name,
  slug,
  tagline,
  description,
  detailedDescription,
  educationalProgramDescription,
  gradient,
  badgeColor,
  icon,
  examples,
  features,
}: SubjectPageProps) {
  const heroRef = useRef<HTMLElement>(null);
  const heroInView = useInView(heroRef, { once: true });
  const examplesRef = useRef<HTMLElement>(null);
  const examplesInView = useInView(examplesRef, { once: true, margin: "-80px" });
  const featuresRef = useRef<HTMLElement>(null);
  const featuresInView = useInView(featuresRef, { once: true, margin: "-80px" });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(subjectBreadcrumbJsonLd(name, slug)),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(subjectEducationalProgramJsonLd(name, slug, educationalProgramDescription)),
        }}
      />

      {/* Hero */}
      <section ref={heroRef} className="relative overflow-hidden px-6 pt-32 pb-20 md:pt-40 md:pb-28">
        <div
          className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-[0.04]`}
        />
        <div className="relative mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={heroInView ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.5 }}
            className={`mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-[--radius-xl] bg-gradient-to-br ${gradient} text-white shadow-lg`}
            aria-hidden="true"
          >
            {icon}
          </motion.div>
          {/* Subject tabs */}
          <motion.nav
            initial={{ opacity: 0, y: 12 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.05, duration: 0.4 }}
            className="mb-8 flex items-center justify-center gap-2"
            aria-label="Subjects"
          >
            {ALL_SUBJECTS.map((s) => {
              const isActive = s.name === name;
              return (
                <Link
                  key={s.name}
                  href={s.href}
                  className={`rounded-[--radius-pill] px-5 py-2 text-sm font-semibold transition-all ${
                    isActive
                      ? "bg-gradient-to-r text-white shadow-sm " + s.gradient
                      : "border border-border-light bg-surface text-text-secondary hover:border-primary-light hover:text-primary"
                  }`}
                >
                  {s.name}
                </Link>
              );
            })}
          </motion.nav>
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="text-4xl font-black leading-[1.1] tracking-tight text-text-primary sm:text-5xl md:text-6xl"
          >
            {tagline}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-text-secondary"
          >
            {description}
          </motion.p>
          {detailedDescription && (
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={heroInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.25, duration: 0.5 }}
              className="mx-auto mt-4 max-w-2xl text-base text-text-muted"
            >
              {detailedDescription}
            </motion.p>
          )}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.35, duration: 0.4 }}
            className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
          >
            <Link
              href="/register"
              className={`inline-flex items-center rounded-[--radius-pill] bg-gradient-to-r ${gradient} px-8 py-3.5 text-base font-semibold text-white shadow-md transition-transform hover:scale-[1.03]`}
            >
              Start Learning {name} Free
            </Link>
            <Link
              href="/#features"
              className="inline-flex items-center rounded-[--radius-pill] border border-border-light bg-surface px-8 py-3.5 text-base font-semibold text-text-primary transition-all hover:border-primary-light hover:shadow-sm"
            >
              See How It Works
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Example Problems */}
      <section ref={examplesRef} className="bg-bg-secondary px-6 py-20 md:py-28">
        <div className="mx-auto max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={examplesInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5 }}
            className="mb-14 text-center"
          >
            <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
              Problems You Can Solve
            </h2>
            <p className="mt-4 text-lg text-text-secondary">
              Snap a photo or type any of these — Veradic walks you through every step
            </p>
          </motion.div>
          <div className="grid gap-4 sm:grid-cols-2">
            {examples.map((ex, i) => (
              <motion.div
                key={ex.topic}
                initial={{ opacity: 0, y: 16 }}
                animate={examplesInView ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.08 * i, duration: 0.4 }}
                className="rounded-[--radius-lg] border border-border-light bg-surface p-6 transition-all hover:border-primary-light hover:shadow-sm"
              >
                <span
                  className="mb-2 inline-block rounded-[--radius-pill] px-3 py-1 text-xs font-semibold"
                  style={{ color: badgeColor, backgroundColor: `${badgeColor}14` }}
                >
                  {ex.topic}
                </span>
                <p className="mt-2 text-text-primary font-medium">{ex.problem}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section ref={featuresRef} className="px-6 py-20 md:py-28">
        <div className="mx-auto max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={featuresInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5 }}
            className="mb-14 text-center"
          >
            <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
              Built for {name} Students
            </h2>
          </motion.div>
          <div className="grid gap-6 sm:grid-cols-2">
            {features.map((feat, i) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 16 }}
                animate={featuresInView ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.1 * i, duration: 0.4 }}
                className="rounded-[--radius-lg] border border-border-light bg-surface p-6"
              >
                <h3 className="text-lg font-bold text-text-primary">{feat.title}</h3>
                <p className="mt-2 text-text-secondary leading-relaxed">{feat.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Explore Other Subjects */}
      <section className="bg-bg-secondary px-6 py-20 md:py-28">
        <div className="mx-auto max-w-4xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
              Explore Other Subjects
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            {ALL_SUBJECTS.filter((s) => s.name !== name).map((s) => (
              <Link
                key={s.name}
                href={s.href}
                className="group rounded-[--radius-xl] border border-border-light bg-surface p-6 transition-all hover:border-primary-light hover:shadow-lg"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[--radius-lg] bg-gradient-to-br ${s.gradient} text-white shadow-md`}
                    aria-hidden="true"
                  >
                    {s.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-text-primary group-hover:text-primary transition-colors">
                      {s.name} Tutor
                    </h3>
                    <p className="text-sm text-text-secondary">
                      {s.description}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl rounded-[--radius-xl] border border-border-light bg-surface p-12 text-center md:p-16">
          <h2 className="text-3xl font-extrabold text-text-primary md:text-4xl">
            Ready to master {name.toLowerCase()}?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-lg text-text-secondary">
            Join thousands of students who are learning {name.toLowerCase()} step by step with Veradic.
          </p>
          <Link
            href="/register"
            className={`mt-8 inline-flex items-center rounded-[--radius-pill] bg-gradient-to-r ${gradient} px-8 py-3.5 text-base font-semibold text-white shadow-md transition-transform hover:scale-[1.03]`}
          >
            Get Started Free
          </Link>
        </div>
      </section>
    </>
  );
}
