import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import { Section } from "@/components/landing/section";
import { Eyebrow } from "@/components/landing/eyebrow";
import { CtaBand } from "@/components/landing/cta-band";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Security, Privacy & Academic Integrity | Veradic AI",
  description:
    "How Veradic AI handles student data, safeguards academic integrity, moderates content, and stays safe in the classroom. Built for schools from day one.",
  openGraph: {
    title: "Security & Privacy | Veradic AI",
    description:
      "How Veradic AI handles student data, safeguards academic integrity, and stays safe in the classroom.",
    url: `${SITE_URL}/security`,
  },
  alternates: {
    canonical: `${SITE_URL}/security`,
  },
};

const pillars = [
  {
    title: "Student data privacy",
    body: "We only collect what's needed to teach. Students and schools can export or delete their data at any time.",
  },
  {
    title: "No training on student work",
    body: "Your students' submissions, chats, and sessions are never used to train AI models: ours or anyone else's.",
  },
  {
    title: "Academic integrity by design",
    body: "Veradic is architected so the AI cannot simply hand over an answer. Every session is a guided conversation, not an answer drop.",
  },
  {
    title: "Teacher-controlled content",
    body: "In school mode, students can only work on problems from their teacher's approved bank. No open photo uploads, no jailbreaks, no surprises.",
  },
];

const subprocessors = [
  { name: "Anthropic", purpose: "Provides the Claude AI model that powers tutoring." },
  { name: "Vercel", purpose: "Hosts the Veradic website and app infrastructure." },
  { name: "Neon / managed Postgres", purpose: "Stores school, user, and session data in encrypted databases." },
  { name: "Cloudflare", purpose: "CDN, DDoS protection, and edge routing." },
  { name: "RevenueCat", purpose: "Manages subscription billing for individual plans." },
];

export default function SecurityPage() {
  return (
    <>
      <Navbar />
      <main>
        {/* Hero */}
        <section className="relative flex min-h-[calc(100dvh_-_4rem)] items-center overflow-hidden bg-[color:var(--color-surface)] md:min-h-[calc(100dvh_-_5rem)]">
          <div className="pointer-events-none absolute right-0 top-0 hidden h-[520px] w-[520px] rounded-full bg-gradient-to-br from-[color:var(--color-primary)]/10 to-transparent blur-3xl md:block" />

          <div className="relative mx-auto w-full max-w-3xl px-6 py-12 md:px-8 md:py-16">
            <Eyebrow>Security &amp; privacy</Eyebrow>
            <h1 className="mt-6 text-display-lg text-[color:var(--color-text)]">
              Built to be safe in schools.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-[color:var(--color-text-secondary)]">
              Veradic was built from the beginning to live in classrooms.
              That&rsquo;s a different bar than a consumer chatbot has to
              clear, and we hold ourselves to it.
            </p>
            <p className="mt-4 text-sm text-[color:var(--color-text-muted)]">
              Questions?{" "}
              <a
                href="mailto:security@veradicai.com"
                className="font-semibold text-[color:var(--color-primary)] hover:underline"
              >
                security@veradicai.com
              </a>
            </p>
          </div>
        </section>

        {/* Pillars */}
        <Section variant="alt">
          <div className="grid gap-6 md:grid-cols-2">
            {pillars.map((p) => (
              <div
                key={p.title}
                className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-8"
              >
                <h2 className="text-xl font-bold text-[color:var(--color-text)]">
                  {p.title}
                </h2>
                <p className="mt-3 text-base leading-relaxed text-[color:var(--color-text-secondary)]">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* Detailed sections */}
        <Section variant="default">
          <div className="mx-auto max-w-3xl space-y-14">
            <Detail
              heading="What data we collect, and why"
              body={
                <>
                  <p>
                    Veradic collects the minimum data needed to teach: account
                    information (name, email, role, school), learning sessions
                    (the problems your students worked on and the steps they
                    went through), and basic usage telemetry so we can fix
                    bugs and improve the product.
                  </p>
                  <p>
                    We don&rsquo;t build advertising profiles. We don&rsquo;t
                    sell data. We don&rsquo;t share identifiable student data
                    with third parties except the processors listed at the
                    bottom of this page.
                  </p>
                </>
              }
            />

            <Detail
              heading="Where data is stored and for how long"
              body={
                <>
                  <p>
                    Student and school data is stored in encrypted databases
                    hosted by our managed-Postgres provider, in United States
                    data centers. Backups are encrypted at rest.
                  </p>
                  <p>
                    Schools can request full data export or deletion at any
                    time. On account closure, we delete identifiable data
                    within 30 days, keeping only the anonymized aggregates
                    needed for service reliability.
                  </p>
                </>
              }
            />

            <Detail
              heading="FERPA and COPPA posture"
              body={
                <>
                  <p>
                    Veradic is built with FERPA and COPPA principles in mind:
                    we treat student records as education records, keep them
                    under school control, and don&rsquo;t sell or market to
                    students based on their data.
                  </p>
                  <p className="text-sm text-[color:var(--color-text-muted)]">
                    <strong>Honest note:</strong> Veradic does not currently
                    hold formal FERPA or COPPA certifications. If your
                    district requires signed agreements around data handling,
                    reach out to{" "}
                    <a
                      href="mailto:security@veradicai.com"
                      className="text-[color:var(--color-primary)] hover:underline"
                    >
                      security@veradicai.com
                    </a>{" "}
                    and we&rsquo;ll work with your legal team.
                  </p>
                </>
              }
            />

            <Detail
              heading="Academic integrity: how the checker works"
              body={
                <>
                  <p>
                    When a student submits homework, Veradic asks them
                    follow-up questions about the specific steps in their own
                    submission: questions that are easy to answer if they
                    did the work, and hard to answer if they didn&rsquo;t.
                  </p>
                  <p>
                    Teachers see an integrity score and the relevant
                    student&rsquo;s responses. The score is a signal, not a
                    verdict: teachers always make the final call.
                  </p>
                </>
              }
            />

            <Detail
              heading="Model safety and content moderation"
              body={
                <>
                  <p>
                    Veradic runs on top of Anthropic&rsquo;s Claude model
                    with a classroom-safety system prompt layered on top. The
                    model is instructed to never give students the final
                    answer directly, to refuse off-topic conversations, and
                    to decline requests that would help a student cheat.
                  </p>
                  <p>
                    In school mode, students cannot upload arbitrary photos
                    or chat freely with the AI. They can only work on
                    problems from their teacher&rsquo;s approved bank. This
                    closes the common jailbreak vectors you see with open
                    chatbots.
                  </p>
                </>
              }
            />

            <Detail
              heading="Subprocessors we use"
              body={
                <ul className="list-disc pl-5">
                  {subprocessors.map((s) => (
                    <li key={s.name} className="mt-2">
                      <strong className="text-[color:var(--color-text)]">
                        {s.name}
                      </strong>
                      <span className="text-[color:var(--color-text-secondary)]">
                        {": "}
                        {s.purpose}
                      </span>
                    </li>
                  ))}
                </ul>
              }
            />
          </div>
        </Section>

        {/* Related links */}
        <Section variant="alt">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>Related</Eyebrow>
            <h2 className="mt-6 text-display-sm text-[color:var(--color-text)]">
              Read the legal pages
            </h2>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                href="/privacy"
                className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-6 py-3 text-sm font-semibold text-[color:var(--color-text)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms"
                className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-6 py-3 text-sm font-semibold text-[color:var(--color-text)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
              >
                Terms of Service
              </Link>
              <Link
                href="/support"
                className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-6 py-3 text-sm font-semibold text-[color:var(--color-text)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
              >
                Support
              </Link>
            </div>
          </div>
        </Section>

        <CtaBand
          eyebrow="Still have questions?"
          headline="We'll talk to your legal team."
          subhead="Data-processing agreements, subprocessor questionnaires, security reviews. We've answered them all before."
          primaryLabel="Email security"
          primaryHref="mailto:security@veradicai.com"
          secondaryLabel="Book a demo"
          secondaryHref="/teachers#contact"
        />
      </main>
      <Footer />
    </>
  );
}

function Detail({
  heading,
  body,
}: {
  heading: string;
  body: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-display-sm text-[color:var(--color-text)]">
        {heading}
      </h2>
      <div className="mt-4 space-y-4 text-base leading-relaxed text-[color:var(--color-text-secondary)]">
        {body}
      </div>
    </div>
  );
}
