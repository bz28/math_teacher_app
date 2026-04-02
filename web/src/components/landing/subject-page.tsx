"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";

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
  tagline: string;
  description: string;
  gradient: string;
  iconGradient: string;
  badgeColor: string;
  badgeBg: string;
  icon: React.ReactNode;
  examples: ExampleProblem[];
  features: Feature[];
}

export function SubjectPage({
  name,
  tagline,
  description,
  gradient,
  iconGradient,
  badgeColor,
  badgeBg,
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
            className={`mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-[--radius-xl] bg-gradient-to-br ${iconGradient} text-white shadow-lg`}
          >
            {icon}
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="text-4xl font-extrabold tracking-tight text-text-primary md:text-6xl"
          >
            {tagline}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary md:text-xl"
          >
            {description}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.35, duration: 0.4 }}
            className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
          >
            <Link
              href="/register"
              className={`inline-flex items-center rounded-[--radius-pill] bg-gradient-to-r ${iconGradient} px-8 py-3.5 text-base font-semibold text-white shadow-md transition-transform hover:scale-[1.03]`}
            >
              Start Learning {name} Free
            </Link>
            <Link
              href="/#how-it-works"
              className="inline-flex items-center rounded-[--radius-pill] border border-border-light bg-surface px-8 py-3.5 text-base font-semibold text-text-primary transition-all hover:border-primary-light hover:shadow-sm"
            >
              See How It Works
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Example Problems */}
      <section ref={examplesRef} className="px-6 py-20 md:py-28">
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
              Snap a photo or type any of these — Veradic AI walks you through every step
            </p>
          </motion.div>
          <div className="grid gap-4 sm:grid-cols-2">
            {examples.map((ex, i) => (
              <motion.div
                key={i}
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
                key={i}
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

      {/* CTA */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl rounded-[--radius-xl] border border-border-light bg-surface p-12 text-center md:p-16">
          <h2 className="text-3xl font-extrabold text-text-primary md:text-4xl">
            Ready to master {name.toLowerCase()}?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-lg text-text-secondary">
            Join thousands of students who are learning {name.toLowerCase()} step by step with Veradic AI.
          </p>
          <Link
            href="/register"
            className={`mt-8 inline-flex items-center rounded-[--radius-pill] bg-gradient-to-r ${iconGradient} px-8 py-3.5 text-base font-semibold text-white shadow-md transition-transform hover:scale-[1.03]`}
          >
            Get Started Free
          </Link>
        </div>
      </section>
    </>
  );
}
