"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import { contact } from "@/lib/api";

const FEATURES = [
  {
    title: "Manage Courses & Rosters",
    description: "Create courses, organize class sections, and invite students with shareable join codes.",
    icon: BookOpenIcon,
  },
  {
    title: "Track Student Progress",
    description: "See which students are struggling and on what topics. AI-powered analytics show you what matters.",
    icon: ChartIcon,
  },
  {
    title: "AI-Graded Homework",
    description: "Students photograph their work, AI grades it step-by-step. You review and override where needed.",
    icon: CheckBadgeIcon,
    comingSoon: true,
  },
  {
    title: "Generate Tests Instantly",
    description: "Pick a topic and difficulty. AI creates tests with answer keys and variants to prevent cheating.",
    icon: DocumentIcon,
    comingSoon: true,
  },
];

const STEPS = [
  { step: "1", title: "We set up your school", description: "We create your school account and invite your teachers." },
  { step: "2", title: "Teachers create courses", description: "Set up courses, organize class sections, and upload materials." },
  { step: "3", title: "Students join with a code", description: "Share a 6-character join code. Students enter it and they're in." },
  { step: "4", title: "AI does the heavy lifting", description: "Students get personalized step-by-step tutoring. You see the data." },
];

export default function TeachersPage() {
  const [form, setForm] = useState({
    school_name: "",
    contact_name: "",
    contact_email: "",
    role: "teacher",
    approx_students: "",
    message: "",
  });
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
        role: form.role,
        approx_students: form.approx_students ? parseInt(form.approx_students) : undefined,
        message: form.message.trim() || undefined,
      });
      setSubmitted(true);
    } catch {
      // Fallback — still show success since we don't want to block the user
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
              Give every student a personal AI tutor that explains problems
              step-by-step &mdash; while you track progress and focus on what
              matters most.
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
                href="#features"
                className="inline-flex h-12 items-center gap-2 rounded-[--radius-pill] border border-border bg-surface px-8 text-base font-semibold text-text-secondary transition-colors hover:border-primary/30 hover:text-primary"
              >
                See Features
              </a>
            </motion.div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="bg-bg-secondary px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
                Everything You Need
              </h2>
              <p className="mt-3 text-text-secondary">
                Tools built for how teachers actually work.
              </p>
            </div>

            <div className="mt-14 grid gap-6 md:grid-cols-2">
              {FEATURES.map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="rounded-[--radius-lg] border border-border-light bg-surface p-6 shadow-sm"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[--radius-md] bg-primary-bg text-primary">
                      <f.icon />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-text-primary">{f.title}</h3>
                        {f.comingSoon && (
                          <span className="rounded-[--radius-pill] bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:bg-amber-500/10">
                            Coming Soon
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                        {f.description}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="px-6 py-20">
          <div className="mx-auto max-w-4xl">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
                How It Works
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
        <section id="contact" className="bg-bg-secondary px-6 py-20">
          <div className="mx-auto max-w-2xl">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
                Bring Veradic AI to Your School
              </h2>
              <p className="mt-3 text-text-secondary">
                Tell us about your school and we&rsquo;ll reach out to set everything up.
              </p>
            </div>

            {submitted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-10 rounded-[--radius-xl] border border-green-200 bg-green-50 p-8 text-center dark:border-green-500/20 dark:bg-green-500/5"
              >
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/10">
                  <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-text-primary">Thank you!</h3>
                <p className="mt-2 text-text-secondary">
                  We&rsquo;ve received your request and will be in touch soon to schedule a demo.
                </p>
              </motion.div>
            ) : (
              <motion.form
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                onSubmit={handleSubmit}
                className="mt-10 space-y-5 rounded-[--radius-xl] border border-border-light bg-surface p-8 shadow-sm"
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <FormField label="School Name" required>
                    <input
                      type="text"
                      value={form.school_name}
                      onChange={(e) => setForm({ ...form, school_name: e.target.value })}
                      placeholder="Lincoln High School"
                      required
                      className="w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary"
                    />
                  </FormField>
                  <FormField label="Your Name" required>
                    <input
                      type="text"
                      value={form.contact_name}
                      onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                      placeholder="Jane Smith"
                      required
                      className="w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary"
                    />
                  </FormField>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <FormField label="Email" required>
                    <input
                      type="email"
                      value={form.contact_email}
                      onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                      placeholder="jsmith@school.edu"
                      required
                      className="w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary"
                    />
                  </FormField>
                  <FormField label="Your Role">
                    <select
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                      className="w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-primary"
                    >
                      <option value="teacher">Teacher</option>
                      <option value="department_head">Department Head</option>
                      <option value="admin">School Administrator</option>
                      <option value="it_director">IT Director</option>
                      <option value="other">Other</option>
                    </select>
                  </FormField>
                </div>

                <FormField label="Approximate Number of Students">
                  <input
                    type="number"
                    value={form.approx_students}
                    onChange={(e) => setForm({ ...form, approx_students: e.target.value })}
                    placeholder="e.g. 200"
                    min="1"
                    className="w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary"
                  />
                </FormField>

                <FormField label="Message (optional)">
                  <textarea
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    placeholder="Tell us about your school, what subjects you teach, or any questions you have..."
                    rows={3}
                    className="w-full resize-vertical rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary"
                  />
                </FormField>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-[--radius-md] bg-gradient-to-r from-primary to-primary-light py-3 text-base font-bold text-white shadow-md transition-all hover:shadow-lg disabled:opacity-60"
                >
                  {submitting ? "Sending..." : "Request a Demo"}
                </button>
              </motion.form>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-semibold tracking-wide text-text-secondary">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function ArrowDown() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  );
}

function BookOpenIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </svg>
  );
}

function CheckBadgeIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12l2 2 4-4" />
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  );
}
