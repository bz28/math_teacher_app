"use client";

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import {
  AnimatedLearnDemo,
  AnimatedGradingDemo,
  getLearnSubstepCount,
  GRADING_SUBSTEP_COUNT,
} from "@/components/landing/animated-demo";
import { StickyShowcase } from "@/components/landing/sticky-showcase";
import { contact } from "@/lib/api";
import { jumpTo } from "@/lib/utils";
import { ScrollingTopics } from "@/components/landing/scrolling-topics";

const PAIN_POINTS = [
  "Wishing you could give every student 1-on-1 time, but there's only one of you",
  "Wondering if your class actually got last week's lesson — or just nodded along",
  "Spending Sunday nights building problem sets instead of recharging",
  "Staring at a pile of papers that won't grade themselves",
];

const FEATURES = [
  {
    icon: TutorIcon,
    title: "Every student gets a personal tutor",
    description: "AI breaks problems into steps and walks each student through at their own pace. No one gets left behind, no one gets bored.",
  },
  {
    icon: InsightIcon,
    title: "See who's struggling — and on what",
    description: "Student sessions are tracked to your class. You'll know exactly where to focus your time when you walk in Monday morning.",
  },
  {
    icon: GradeIcon,
    title: "Homework grades itself",
    description: "Students photograph their work, AI grades it step-by-step. You review, override where needed, and move on.",
  },
  {
    icon: TestIcon,
    title: "Tests generated in seconds",
    description: "Pick a topic, set the difficulty. AI creates a test with answer key and variants so no two students get the same version.",
  },
];

export default function TeachersPage() {
  const [form, setForm] = useState({ school_name: "", contact_name: "", contact_email: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await contact.submitLead({
        school_name: form.school_name.trim(),
        contact_name: form.contact_name.trim(),
        contact_email: form.contact_email.trim(),
        role: "teacher",
        message: form.message.trim() || undefined,
      });
      setSubmitted(true);
    } catch {
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <ScrollingTopics subject="teacher" />
      <Navbar />
      <main>
        {/* ── Hero ── */}
        <section className="relative flex min-h-[calc(100vh-4rem)] items-center overflow-hidden bg-gradient-to-b from-primary-bg/40 via-transparent to-transparent px-6">
          <div className="relative mx-auto max-w-4xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-5 inline-flex items-center gap-2 rounded-[--radius-pill] border border-primary/20 bg-primary-bg px-4 py-1.5 text-sm font-semibold text-primary"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              For Schools &amp; Teachers
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-4xl font-black leading-[1.1] tracking-tight text-text-primary sm:text-5xl md:text-6xl"
            >
              AI-Powered Tutoring{" "}
              <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                for Your Classroom
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-text-secondary"
            >
              A personal AI tutor for every student in your classroom:
              step-by-step guidance at every student&rsquo;s pace, automated
              grading, endless practice problems, and actionable insights
              &mdash; so you can spend your time where it matters most.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
            >
              <a
                href="#contact"
                onClick={(e) => { e.preventDefault(); jumpTo("#contact"); }}
                className="inline-flex h-12 items-center gap-2 rounded-[--radius-pill] bg-primary px-8 text-base font-bold text-white transition-colors hover:bg-primary-dark"
              >
                Request a Demo
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
              </a>
              <a
                href="#outcomes"
                onClick={(e) => { e.preventDefault(); jumpTo("#outcomes"); }}
                className="inline-flex h-12 items-center gap-2 rounded-[--radius-pill] border border-border bg-surface px-8 text-base font-semibold text-text-secondary transition-colors hover:border-primary/30 hover:text-primary"
              >
                See How It Helps
              </a>
            </motion.div>
          </div>
        </section>

        {/* ── Pain Points ── */}
        <section className="px-6 py-20 md:py-24">
          <div className="mx-auto max-w-3xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center"
            >
              <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
                You became a teacher to teach.
              </h2>
              <p className="mt-2 text-2xl font-bold tracking-tight text-text-muted md:text-3xl">
                Not to drown in paperwork.
              </p>
            </motion.div>

            <div className="mx-auto mt-10 max-w-xl space-y-3">
              {PAIN_POINTS.map((point, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.07 }}
                  className="flex items-center gap-3 rounded-[--radius-md] border-l-2 border-text-muted/30 bg-card/30 px-5 py-3"
                >
                  <span className="text-base leading-relaxed text-text-secondary">{point}</span>
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="mt-10 text-center"
            >
              <p className="text-xl font-bold text-primary md:text-2xl">
                What if AI handled the repetitive parts?
              </p>
              <div className="mx-auto mt-3 h-px w-16 bg-primary/30" />
            </motion.div>
          </div>
        </section>

        {/* ── What Teachers Get ── */}
        <section id="outcomes" className="bg-gradient-to-b from-transparent via-primary-bg/20 to-transparent px-6 py-20 md:py-24">
          <div className="mx-auto max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center"
            >
              <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
                What Teachers Get
              </h2>
              <p className="mt-3 text-text-secondary">
                Less busywork. More impact.
              </p>
            </motion.div>

            <div className="mt-14 grid gap-6 md:grid-cols-2">
              {FEATURES.map((feature, i) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="group rounded-[--radius-lg] border border-border-light bg-surface p-6 shadow-sm transition-all hover:border-primary/20 hover:shadow-md"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[--radius-md] bg-primary-bg text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                    <feature.icon />
                  </div>
                  <h3 className="text-lg font-bold text-text-primary">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    {feature.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Product Showcase — sticky scroll ── */}
        <StickyShowcase
          heading="See What Your Students Experience"
          subheading="Every student gets a personal AI tutor that adapts to their pace"
          features={[
            {
              title: "Step-by-Step Guidance",
              description:
                "Students work through problems one step at a time. The answer stays hidden until they've built real understanding — no shortcuts, no copying.",
              substepCount: getLearnSubstepCount(),
              render: (n) => <AnimatedLearnDemo visibleCount={n} />,
            },
            {
              title: "Automatic Grading",
              description:
                "Students photograph their work, AI grades each step individually. You see exactly where mistakes happen — review, override, and move on.",
              substepCount: GRADING_SUBSTEP_COUNT,
              render: (n) => <AnimatedGradingDemo visibleCount={n} />,
            },
          ]}
        />

        {/* ── Contact Form ── */}
        <section id="contact" className="px-6 py-20 md:py-24">
          <div className="mx-auto max-w-5xl">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
                Bring Veradic AI to Your School
              </h2>
              <p className="mt-3 text-text-secondary">
                Tell us where you teach. We&rsquo;ll handle the rest.
              </p>
            </div>

            {submitted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mx-auto mt-10 max-w-lg rounded-[--radius-xl] border border-green-200 bg-green-50 p-8 text-center dark:border-green-500/20 dark:bg-green-500/5"
              >
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/10">
                  <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-text-primary">Thank you!</h3>
                <p className="mt-2 text-text-secondary">
                  We&rsquo;ll be in touch within 24 hours to schedule a demo.
                </p>
              </motion.div>
            ) : (
              <div className="mt-10 grid gap-10 md:grid-cols-2 md:items-start">
                {/* Left: what happens */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className="space-y-6"
                >
                  {/* Phase 1: After you submit */}
                  <div>
                    <h3 className="text-lg font-bold text-text-primary">After you reach out</h3>
                    <div className="mt-4 space-y-4">
                      <StepItem num="1" title="We respond within 24 hours" desc="A quick email to say hello and find a time that works." />
                      <StepItem num="2" title="15-minute demo call" desc="We walk you through the platform and answer your questions. No pressure." />
                    </div>
                  </div>

                  {/* Phase 2: Getting set up */}
                  <div className="border-t border-border-light pt-5">
                    <h3 className="text-sm font-bold text-text-muted">Then we get you set up</h3>
                    <div className="mt-4 space-y-4">
                      <StepItem num="3" title="We create your school" desc="We handle the account setup and invite your teachers." />
                      <StepItem num="4" title="Organize your classes" desc="Create courses and sections — Algebra I Period 3, Chemistry Block A." />
                      <StepItem num="5" title="Students join with a code" desc="Share a 6-character code. No emails, no paperwork." />
                      <StepItem num="6" title="You're live" desc="Students get step-by-step help. You focus on teaching." />
                    </div>
                  </div>

                  <div className="rounded-[--radius-lg] bg-primary-bg/50 px-4 py-3">
                    <p className="text-xs leading-relaxed text-text-secondary">
                      No commitment required. No credit card. We just want to show you what&rsquo;s possible.
                    </p>
                  </div>
                </motion.div>

                {/* Right: form */}
                <motion.form
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  onSubmit={handleSubmit}
                  className="space-y-4 rounded-[--radius-xl] border border-border-light bg-surface p-8 shadow-sm"
                >
                  <div>
                    <label className="text-[13px] font-semibold tracking-wide text-text-secondary">
                      Your Name<span className="ml-0.5 text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.contact_name}
                      onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                      placeholder="Jane Smith"
                      required
                      className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[13px] font-semibold tracking-wide text-text-secondary">
                      Work Email<span className="ml-0.5 text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      value={form.contact_email}
                      onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                      placeholder="jsmith@school.edu"
                      required
                      className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[13px] font-semibold tracking-wide text-text-secondary">
                      School Name<span className="ml-0.5 text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.school_name}
                      onChange={(e) => setForm({ ...form, school_name: e.target.value })}
                      placeholder="Lincoln High School"
                      required
                      className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[13px] font-semibold tracking-wide text-text-secondary">
                      Anything else we should know?
                    </label>
                    <textarea
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      placeholder="e.g. how many students, what subjects, timeline..."
                      rows={3}
                      className="mt-1 w-full resize-vertical rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-[--radius-md] bg-primary py-3 text-base font-bold text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
                  >
                    {submitting ? "Sending..." : "Request a Demo"}
                  </button>
                </motion.form>
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

/* ── Step item for contact section ── */
function StepItem({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-bg text-xs font-bold text-primary">
        {num}
      </div>
      <div>
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-muted">{desc}</div>
      </div>
    </div>
  );
}

/* ── Icons ── */
function TutorIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function InsightIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
      <path d="M11 8v6M8 11h6" />
    </svg>
  );
}

function GradeIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  );
}

function TestIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  );
}
