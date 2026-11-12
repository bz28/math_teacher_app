"use client";

import { useState, type FormEvent } from "react";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import { contact } from "@/lib/api";

/**
 * Book a demo, in the notebook design: what the call is on the left, the
 * request form on a white sheet on the right.
 *
 * The form sends a contact lead (POST /contact/lead, api/routes/contact.py),
 * which emails the team; the team then emails back to set a time. There is
 * no calendar step, so the copy says exactly that.
 */

const STEPS = [
  {
    title: "We write homework from your chapter.",
    body: "Problems and worked solutions, checked first.",
  },
  {
    title: "You submit it as a student.",
    body: "See the understanding check from their side.",
  },
  {
    title: "You grade it with your rules.",
    body: "Write a rule, watch the draft grade use it.",
  },
];

const FIELD =
  "mt-2 block w-full rounded-[6px] border-[1.5px] border-[#8A919C] bg-[#FBFAF6] px-3.5 py-[13px] text-base font-medium text-ink placeholder:text-[#6B7280] transition-colors hover:border-ink focus:border-veradic";
const LABEL = "block text-[15px] font-bold";
const OPTIONAL = "font-medium text-ink-soft";

export default function DemoPage() {
  const [form, setForm] = useState({
    school_name: "",
    contact_name: "",
    contact_email: "",
    approx_students: "",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Parse approx_students leniently — empty stays undefined,
      // non-numeric drops to undefined, decimals get rounded to the
      // nearest integer (backend column is INT). Backend column
      // accepts NULL so omitting it is fine.
      const trimmed = form.approx_students.trim();
      const parsed = trimmed ? Number(trimmed) : NaN;
      const students =
        Number.isFinite(parsed) && parsed >= 0
          ? Math.round(parsed)
          : undefined;
      await contact.submitLead({
        school_name: form.school_name.trim(),
        contact_name: form.contact_name.trim(),
        contact_email: form.contact_email.trim(),
        role: "teacher",
        approx_students: students,
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
    <div className="site graph-paper flex min-h-full flex-1 flex-col">
      <Navbar />
      <main className="flex-1">
        <section className="mx-auto flex max-w-[1200px] flex-wrap items-start gap-x-20 gap-y-14 px-4 pb-20 pt-12 md:px-8 md:pb-28 md:pt-14">
          <div className="min-w-0 flex-[1_1_440px]">
            <h1 className="site-h1">See Veradic on your own chapter.</h1>
            <p className="mt-6 max-w-[30em] text-lg leading-[1.55] text-ink-soft md:text-xl">
              A 20-minute call with the team that builds it. Bring a chapter
              you&rsquo;re teaching and we&rsquo;ll run it live.
            </p>
            <ol className="m-0 mt-11 flex list-none flex-col gap-[22px] p-0">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex items-baseline gap-[18px]">
                  {/* The number in red pen. */}
                  <span aria-hidden="true" className="w-[26px] flex-none font-hand text-[32px] leading-none text-redpen">
                    {i + 1}
                  </span>
                  <span className="text-lg leading-normal">
                    <b>{s.title}</b> {s.body}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="w-full min-w-0 max-w-[520px] flex-[1_1_440px]">
            {submitted ? <Thanks /> : (
              <form
                onSubmit={handleSubmit}
                aria-labelledby="demo-form-title"
                className="rotate-[0.5deg] rounded-[4px] border border-hairline bg-white p-6 shadow-[0_30px_60px_-30px_rgba(29,38,51,0.45)] sm:p-9"
              >
                <h2 id="demo-form-title" className="m-0 mb-6 text-2xl font-black tracking-[-0.02em]">
                  Request a demo
                </h2>
                <div className="space-y-[18px]">
                  <label className={LABEL}>
                    Your name
                    <input
                      type="text"
                      name="name"
                      autoComplete="name"
                      value={form.contact_name}
                      onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                      placeholder="Jordan Rivera"
                      required
                      className={FIELD}
                    />
                  </label>
                  <label className={LABEL}>
                    Work email
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      value={form.contact_email}
                      onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                      placeholder="jrivera@yourdistrict.org"
                      required
                      className={FIELD}
                    />
                  </label>
                  <label className={LABEL}>
                    School or district
                    <input
                      type="text"
                      name="organization"
                      autoComplete="organization"
                      value={form.school_name}
                      onChange={(e) => setForm({ ...form, school_name: e.target.value })}
                      placeholder="Lincoln High School"
                      required
                      className={FIELD}
                    />
                  </label>
                  <label className={LABEL}>
                    About how many students? <span className={OPTIONAL}>(optional)</span>
                    <input
                      type="number"
                      name="students"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={form.approx_students}
                      onChange={(e) => setForm({ ...form, approx_students: e.target.value })}
                      placeholder="e.g. 600"
                      className={FIELD}
                    />
                  </label>
                  <label className={LABEL}>
                    Anything else we should know? <span className={OPTIONAL}>(optional)</span>
                    <textarea
                      name="message"
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      placeholder="e.g. subjects, timeline, what you use now"
                      rows={3}
                      className={`${FIELD} resize-y`}
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-7 w-full rounded-[6px] bg-veradic p-[17px] text-[17px] font-extrabold text-white transition-colors hover:bg-veradic-dark disabled:opacity-60"
                >
                  {submitting ? "Sending…" : "Request a demo"}
                </button>
                <p className="m-0 mt-4 text-sm leading-normal text-ink-soft">
                  We&rsquo;ll email you to set a time. Rather write to us?{" "}
                  <a
                    href="mailto:support@veradicai.com"
                    className="font-bold text-veradic underline underline-offset-2 hover:text-veradic-dark"
                  >
                    support@veradicai.com
                  </a>
                </p>
              </form>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

/** Shown in place of the form once it is sent. role="status" so it is announced. */
function Thanks() {
  return (
    <div
      role="status"
      className="rotate-[0.5deg] rounded-[4px] border border-hairline bg-white p-6 shadow-[0_30px_60px_-30px_rgba(29,38,51,0.45)] sm:p-9"
    >
      <h2 className="m-0 text-2xl font-black tracking-[-0.02em]">Thank you.</h2>
      <p className="m-0 mt-3 text-lg leading-relaxed text-ink-soft">
        We&rsquo;ll be in touch within 24 hours to set a time for your demo.
      </p>
    </div>
  );
}
