"use client";

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import { contact } from "@/lib/api";

const PAIN_POINTS = [
  "Wishing you could give every student 1-on-1 time, but there's only one of you",
  "Wondering if your class actually got last week's lesson — or just nodded along",
  "Spending Sunday nights building problem sets instead of recharging",
  "Staring at a pile of papers that won't grade themselves",
];

const OUTCOMES = [
  {
    title: "Every student gets a personal tutor",
    description: "AI breaks problems into steps and walks each student through at their own pace. No one gets left behind, no one gets bored.",
    icon: TutorIcon,
  },
  {
    title: "You see who's struggling — and on what",
    description: "Student sessions are tracked to your class. You'll know exactly where to focus your time when you walk in Monday morning.",
    icon: InsightIcon,
    comingSoon: true,
  },
  {
    title: "Homework grades itself",
    description: "Students photograph their work, AI grades it step-by-step. You review, override where needed, and move on.",
    icon: GradeIcon,
    comingSoon: true,
  },
  {
    title: "Tests generated in seconds",
    description: "Pick a topic, set the difficulty. AI creates a test with answer key and variants so no two students get the same version.",
    icon: TestIcon,
    comingSoon: true,
  },
];

const STEPS = [
  { step: "1", title: "We set up your school", description: "Tell us about your school. We create your account, invite your teachers, and handle the setup." },
  { step: "2", title: "Create courses and sections", description: "Organize your classes — Algebra I Period 3, Chemistry Block A. Just like your schedule." },
  { step: "3", title: "Students join with a code", description: "Share a 6-character code. Students type it in and they're enrolled. No emails, no paperwork." },
  { step: "4", title: "AI tutors, you teach", description: "Students get step-by-step help on demand. You see the data and focus on what the AI can't do — inspire." },
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
      <Navbar />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden px-6 pb-20 pt-16 md:pb-28 md:pt-24">
          <div className="pointer-events-none absolute inset-0 -top-40 overflow-hidden">
            <div className="absolute left-1/2 top-0 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-gradient-to-br from-primary/10 to-transparent blur-3xl" />
            <div className="absolute left-1/3 top-10 h-[400px] w-[400px] rounded-full bg-gradient-to-br from-primary-light/8 to-transparent blur-3xl" />
          </div>

          <div className="relative mx-auto max-w-4xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-6 inline-flex items-center gap-2 rounded-[--radius-pill] border border-primary/20 bg-primary-bg px-4 py-1.5 text-sm font-semibold text-primary"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              For Schools & Teachers
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-5xl font-extrabold leading-tight tracking-tight text-text-primary md:text-6xl"
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
              className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-text-secondary md:text-xl"
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
              className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
            >
              <a
                href="#contact"
                className="inline-flex h-12 items-center gap-2 rounded-[--radius-pill] bg-gradient-to-r from-primary to-primary-light px-8 text-base font-bold text-white shadow-md transition-shadow hover:shadow-lg"
              >
                Request a Demo
                <ArrowDown />
              </a>
              <a
                href="#outcomes"
                className="inline-flex h-12 items-center gap-2 rounded-[--radius-pill] border border-border bg-surface px-8 text-base font-semibold text-text-secondary transition-colors hover:border-primary/30 hover:text-primary"
              >
                See How It Helps
              </a>
            </motion.div>
          </div>
        </section>

        {/* The Problem */}
        <section className="bg-bg-secondary px-6 py-20">
          <div className="mx-auto max-w-3xl text-center">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl"
            >
              You became a teacher to teach.
              <br />
              <span className="text-text-muted">Not to drown in paperwork.</span>
            </motion.h2>

            <div className="mt-10 space-y-3 text-left">
              {PAIN_POINTS.map((point, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="flex items-center gap-3 rounded-[--radius-lg] border border-border-light bg-surface px-5 py-3.5"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/10">
                    <svg className="h-3.5 w-3.5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-text-primary">{point}</span>
                </motion.div>
              ))}
            </div>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mt-8 text-lg font-semibold text-primary"
            >
              What if AI handled the repetitive parts?
            </motion.p>
          </div>
        </section>

        {/* Outcomes */}
        <section id="outcomes" className="relative px-6 py-20">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute left-1/2 top-0 h-[300px] w-[600px] -translate-x-1/2 rounded-full bg-gradient-to-br from-primary/5 to-transparent blur-3xl" />
          </div>
          <div className="relative mx-auto max-w-5xl">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
                What Teachers Get
              </h2>
              <p className="mt-3 text-text-secondary">
                Less busywork. More impact.
              </p>
            </div>

            <div className="mt-14 grid gap-6 md:grid-cols-2">
              {OUTCOMES.map((o, i) => (
                <motion.div
                  key={o.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="rounded-[--radius-lg] border border-border-light bg-surface p-6 shadow-sm"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[--radius-md] bg-primary-bg text-primary">
                      <o.icon />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-text-primary">{o.title}</h3>
                        {o.comingSoon && (
                          <span className="rounded-[--radius-pill] bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:bg-amber-500/10">
                            Coming Soon
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                        {o.description}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="bg-bg-secondary px-6 py-20">
          <div className="mx-auto max-w-4xl">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
                Getting Started Is Simple
              </h2>
            </div>

            <div className="mt-14 grid gap-8 md:grid-cols-2">
              {STEPS.map((s, i) => (
                <motion.div
                  key={s.step}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="flex gap-4"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-light text-sm font-bold text-white">
                    {s.step}
                  </div>
                  <div>
                    <h3 className="font-bold text-text-primary">{s.title}</h3>
                    <p className="mt-1 text-sm text-text-secondary">{s.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact form */}
        <section id="contact" className="px-6 py-20">
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
                {/* Left: what happens next */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className="space-y-6"
                >
                  <h3 className="text-lg font-bold text-text-primary">What happens next?</h3>
                  {[
                    { num: "1", title: "We reach out within 24 hours", desc: "A quick email to say hello and find a time that works." },
                    { num: "2", title: "15-minute demo call", desc: "We walk you through the platform and answer your questions. No pressure." },
                    { num: "3", title: "Your school goes live", desc: "We set up your school, invite your teachers, and you're ready to go." },
                  ].map((step, i) => (
                    <motion.div
                      key={step.num}
                      initial={{ opacity: 0, y: 10 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1 }}
                      className="flex gap-3"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-bg text-xs font-bold text-primary">
                        {step.num}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-text-primary">{step.title}</div>
                        <div className="mt-0.5 text-xs text-text-muted">{step.desc}</div>
                      </div>
                    </motion.div>
                  ))}
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
                    className="w-full rounded-[--radius-md] bg-gradient-to-r from-primary to-primary-light py-3 text-base font-bold text-white shadow-md transition-all hover:shadow-lg disabled:opacity-60"
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

function ArrowDown() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  );
}

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
