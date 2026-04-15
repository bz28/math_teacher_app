"use client";

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import { Section } from "@/components/landing/section";
import { Eyebrow } from "@/components/landing/eyebrow";
import { FAQ } from "@/components/landing/faq";
import { contact } from "@/lib/api";

export default function DemoPage() {
  const [form, setForm] = useState({
    school_name: "",
    contact_name: "",
    contact_email: "",
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
        {/* ── Compact hero ── */}
        <Section variant="default">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>Book a demo</Eyebrow>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mt-6 text-display-lg text-[color:var(--color-text)]"
            >
              Bring Veradic to your classroom.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--color-text-secondary)]"
            >
              20 minutes. We&rsquo;ll show you exactly how it fits your
              curriculum. No pitch, no pressure.
            </motion.p>
          </div>
        </Section>

        {/* ── Contact section — 2-col: timeline on left, form on right ── */}
        <Section variant="alt" id="contact">
          <div className="mx-auto max-w-5xl">
            <div className="text-center">
              <Eyebrow>Get started</Eyebrow>
              <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
                Tell us where you teach.
              </h2>
              <p className="mt-4 text-lg text-[color:var(--color-text-secondary)]">
                We&rsquo;ll handle the rest.
              </p>
            </div>

            {submitted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mx-auto mt-12 max-w-lg rounded-2xl border border-green-200 bg-green-50 p-10 text-center dark:border-green-500/20 dark:bg-green-500/5"
              >
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/10">
                  <svg
                    className="h-7 w-7 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m4.5 12.75 6 6 9-13.5"
                    />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-[color:var(--color-text)]">
                  Thank you!
                </h3>
                <p className="mt-2 text-[color:var(--color-text-secondary)]">
                  We&rsquo;ll be in touch within 24 hours to schedule a demo.
                </p>
              </motion.div>
            ) : (
              <div className="mt-12 grid gap-12 md:grid-cols-2 md:items-start md:gap-16">
                {/* Left column — "what happens next" timeline */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className="space-y-8"
                >
                  {/* Phase 1: After you submit */}
                  <div>
                    <h3 className="text-lg font-bold text-[color:var(--color-text)]">
                      After you reach out
                    </h3>
                    <div className="mt-5 space-y-5">
                      <StepItem
                        num="1"
                        title="We respond within 24 hours"
                        desc="A quick email to say hello and find a time that works."
                      />
                      <StepItem
                        num="2"
                        title="15-minute demo call"
                        desc="We walk you through the platform and answer your questions. No pressure."
                      />
                    </div>
                  </div>

                  {/* Phase 2: Getting set up */}
                  <div className="border-t border-[color:var(--color-border-light)] pt-6">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-[color:var(--color-text-muted)]">
                      Then we get you set up
                    </h3>
                    <div className="mt-5 space-y-5">
                      <StepItem
                        num="3"
                        title="We create your school"
                        desc="We handle the account setup and invite your teachers."
                      />
                      <StepItem
                        num="4"
                        title="Organize your classes"
                        desc="Create courses and sections: Algebra I Period 3, Chemistry Block A."
                      />
                      <StepItem
                        num="5"
                        title="Students join with a code"
                        desc="Share a 6-character code. No emails, no paperwork."
                      />
                      <StepItem
                        num="6"
                        title="You're live"
                        desc="Students get step-by-step help. You focus on teaching."
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl bg-[color:var(--color-primary-bg)] px-5 py-4">
                    <p className="text-xs leading-relaxed text-[color:var(--color-text-secondary)]">
                      No commitment required. No credit card. We just want to
                      show you what&rsquo;s possible.
                    </p>
                  </div>
                </motion.div>

                {/* Right column — form */}
                <motion.form
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  onSubmit={handleSubmit}
                  className="space-y-5 rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-8"
                >
                  <div>
                    <label className="text-[13px] font-semibold tracking-wide text-[color:var(--color-text-secondary)]">
                      Your Name
                      <span className="ml-0.5 text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.contact_name}
                      onChange={(e) =>
                        setForm({ ...form, contact_name: e.target.value })
                      }
                      placeholder="Jane Smith"
                      required
                      className="mt-1.5 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 text-sm text-[color:var(--color-text)] outline-none transition-colors placeholder:text-[color:var(--color-text-muted)] focus:border-[color:var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="text-[13px] font-semibold tracking-wide text-[color:var(--color-text-secondary)]">
                      Work Email
                      <span className="ml-0.5 text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      value={form.contact_email}
                      onChange={(e) =>
                        setForm({ ...form, contact_email: e.target.value })
                      }
                      placeholder="jsmith@school.edu"
                      required
                      className="mt-1.5 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 text-sm text-[color:var(--color-text)] outline-none transition-colors placeholder:text-[color:var(--color-text-muted)] focus:border-[color:var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="text-[13px] font-semibold tracking-wide text-[color:var(--color-text-secondary)]">
                      School Name
                      <span className="ml-0.5 text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.school_name}
                      onChange={(e) =>
                        setForm({ ...form, school_name: e.target.value })
                      }
                      placeholder="Lincoln High School"
                      required
                      className="mt-1.5 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 text-sm text-[color:var(--color-text)] outline-none transition-colors placeholder:text-[color:var(--color-text-muted)] focus:border-[color:var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="text-[13px] font-semibold tracking-wide text-[color:var(--color-text-secondary)]">
                      Anything else we should know?
                    </label>
                    <textarea
                      value={form.message}
                      onChange={(e) =>
                        setForm({ ...form, message: e.target.value })
                      }
                      placeholder="e.g. how many students, what subjects, timeline..."
                      rows={3}
                      className="mt-1.5 w-full resize-vertical rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 text-sm text-[color:var(--color-text)] outline-none transition-colors placeholder:text-[color:var(--color-text-muted)] focus:border-[color:var(--color-primary)]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-full bg-[color:var(--color-primary)] py-4 text-base font-bold text-white transition-colors hover:bg-[color:var(--color-primary-dark)] disabled:opacity-60"
                  >
                    {submitting ? "Sending..." : "Request a Demo"}
                  </button>
                </motion.form>
              </div>
            )}
          </div>
        </Section>

        {/* ── FAQ — bottom fallback for hesitant readers ── */}
        <FAQ />
      </main>
      <Footer />
    </>
  );
}

/* ── Step item for the "what happens next" timeline ── */
function StepItem({
  num,
  title,
  desc,
}: {
  num: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary-bg)] text-sm font-bold text-[color:var(--color-primary)]">
        {num}
      </div>
      <div>
        <div className="text-base font-semibold text-[color:var(--color-text)]">
          {title}
        </div>
        <div className="mt-1 text-sm text-[color:var(--color-text-muted)]">
          {desc}
        </div>
      </div>
    </div>
  );
}
