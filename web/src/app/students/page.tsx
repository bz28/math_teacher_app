import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import { Section } from "@/components/landing/section";
import { Eyebrow } from "@/components/landing/eyebrow";
import { CtaBand } from "@/components/landing/cta-band";
import { StepsAnimation } from "@/components/landing/steps-animation";
import { gardenDemo } from "@/components/landing/demos/garden-demo";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Homework Help That Guides You, Not Gives Answers | Veradic AI",
  description:
    "Stuck on homework? Veradic walks you through every math, physics, and chemistry problem step by step. You reach the answer, and actually understand how you got there.",
  keywords: [
    "homework help",
    "math homework app",
    "chemistry homework help",
    "physics homework help",
    "ai tutor app",
    "step by step homework",
    "veradic student",
  ],
  openGraph: {
    title: "Veradic for Students: Homework Help That Actually Helps",
    description:
      "Snap a problem. Get guided steps. Practice until you get it. The AI tutor that teaches, instead of telling.",
    url: `${SITE_URL}/students`,
  },
  alternates: {
    canonical: `${SITE_URL}/students`,
  },
};

const features = [
  {
    title: "Snap a problem",
    body: "Take a picture of any math, physics, or chemistry problem. Veradic reads it, cleans it up, and gets it ready to work through with you.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
  },
  {
    title: "Get guided steps",
    body: "Veradic breaks every problem into small, digestible steps that explain the reasoning. If a step doesn't click, you can ask about just that step. No dropped answers. You get there yourself, faster than you would have alone.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h4" />
        <path d="M15 11h4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-4" />
        <path d="M12 2v20" />
      </svg>
    ),
  },
  {
    title: "Practice until you get it",
    body: "Finished a problem? Veradic makes five more just like it with different numbers so the concept actually sticks. Not one-and-done. Real mastery.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
    ),
  },
];

const faqs = [
  {
    q: "Will Veradic just give me the answer?",
    a: "No. That's the whole point. Veradic will guide you through the thinking, but you'll be the one who gets to the answer. You'll learn way more this way, and you won't get caught in class not knowing how you got it.",
  },
  {
    q: "Is it expensive?",
    a: "There's a free tier you can try without paying. If you like it, individual plans are cheap, way less than a real tutor.",
  },
  {
    q: "Does it work for my subject?",
    a: "Today it covers math, physics, and chemistry at the middle school, high school, and college level. More subjects are coming.",
  },
  {
    q: "Can my parents see what I'm doing?",
    a: "Your work and chat history are your own. If you're using Veradic through your school, your teacher can see your sessions for that class.",
  },
  {
    q: "Is my teacher already using Veradic?",
    a: "Some are. If your school uses Veradic, your teacher will share a join code with you. Use it on the sign-in page to connect your account to the class.",
  },
];

export default function StudentsPage() {
  return (
    <>
      <Navbar />
      <main>
        {/* Hero */}
        <section className="relative flex min-h-[calc(100dvh_-_4rem)] items-center overflow-hidden bg-[color:var(--color-surface)] md:min-h-[calc(100dvh_-_5rem)]">
          <div className="pointer-events-none absolute right-0 top-0 hidden h-[600px] w-[600px] rounded-full bg-gradient-to-br from-[color:var(--color-primary)]/10 to-transparent blur-3xl md:block" />
          <div className="pointer-events-none absolute -left-32 top-40 h-[420px] w-[420px] rounded-full bg-gradient-to-br from-[color:var(--color-primary-light)]/10 to-transparent blur-3xl" />

          <div className="relative mx-auto w-full max-w-4xl px-6 py-12 text-center md:px-8 md:py-16">
            <Eyebrow>For students</Eyebrow>
            <h1 className="mt-6 text-display-xl text-[color:var(--color-text)]">
              Get unstuck.
              <br />
              <span className="bg-gradient-to-r from-[color:var(--color-primary)] to-[color:var(--color-primary-light)] bg-clip-text text-transparent">
                Step by step.
              </span>
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
              Snap a problem. Veradic walks you through it, not past it. You
              reach the answer, and for once you actually know how you got
              there.
            </p>
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/register"
                className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[color:var(--color-primary)] px-8 text-base font-bold text-white transition-colors hover:bg-[color:var(--color-primary-dark)]"
              >
                Get started free
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
              <Link
                href="/login"
                className="inline-flex h-14 items-center justify-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-8 text-base font-semibold text-[color:var(--color-text-secondary)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
              >
                I already have an account
              </Link>
            </div>

            {/* TODO: app store badges once mobile app is live on stores */}
            <p className="mt-10 text-sm text-[color:var(--color-text-muted)]">
              Also available on iOS and Android · App store badges coming soon
            </p>
          </div>
        </section>

        {/* See it in action — animated demo */}
        <Section variant="invert">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow variant="invert">See it in action</Eyebrow>
            <h2 className="mt-6 text-display-md text-[color:var(--color-invert-text)]">
              This is what it looks like.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-[color:var(--color-invert-text-muted)]">
              Veradic walks you through one step at a time. Ask when
              you&rsquo;re stuck.
            </p>
          </div>
          <div className="mx-auto mt-14 max-w-2xl">
            <StepsAnimation data={gardenDemo} />
          </div>
        </Section>

        {/* How it works */}
        <Section variant="alt">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
              Three things. That&rsquo;s it.
            </h2>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="marketing-card rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-8"
              >
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--color-primary-bg)] text-[color:var(--color-primary)]">
                  <div className="h-6 w-6">{f.icon}</div>
                </div>
                <span className="text-xs font-semibold tracking-widest text-[color:var(--color-text-muted)]">
                  0{i + 1}
                </span>
                <h3 className="mt-3 text-xl font-bold text-[color:var(--color-text)]">
                  {f.title}
                </h3>
                <p className="mt-3 text-base leading-relaxed text-[color:var(--color-text-secondary)]">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* Subjects */}
        <Section variant="default">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>Subjects</Eyebrow>
            <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
              Pick your subject.
            </h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              { slug: "math", name: "Math", blurb: "Pre-algebra through calculus.", color: "#6C5CE7" },
              { slug: "physics", name: "Physics", blurb: "Mechanics through modern physics.", color: "#0984E3" },
              { slug: "chemistry", name: "Chemistry", blurb: "Stoichiometry through organic.", color: "#00B894" },
            ].map((s) => (
              <Link
                key={s.slug}
                href={`/subjects/${s.slug}`}
                className="marketing-card group rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] p-8"
              >
                <span
                  className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest"
                  style={{ background: `${s.color}14`, color: s.color }}
                >
                  {s.name}
                </span>
                <p className="mt-5 text-xl font-bold text-[color:var(--color-text)]">
                  {s.blurb}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[color:var(--color-primary)] transition-transform group-hover:translate-x-1">
                  Explore →
                </span>
              </Link>
            ))}
          </div>
        </Section>

        {/* School mode call-out */}
        <Section variant="alt">
          <div className="mx-auto max-w-2xl rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-10 text-center">
            <Eyebrow>Using Veradic in class?</Eyebrow>
            <p className="mt-5 text-xl font-semibold text-[color:var(--color-text)]">
              Your teacher will give you a join code.
            </p>
            <p className="mt-3 text-base text-[color:var(--color-text-secondary)]">
              Log in and enter the code your teacher shared to connect your
              account to your class.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-6 py-3 text-sm font-semibold text-[color:var(--color-text)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
            >
              Log in and join your class
            </Link>
          </div>
        </Section>

        {/* Parent / student FAQ */}
        <Section variant="default">
          <div className="mx-auto max-w-3xl">
            <div className="text-center">
              <Eyebrow>Frequently asked</Eyebrow>
              <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
                Questions students (and parents) ask.
              </h2>
            </div>

            <div className="mt-12 space-y-4">
              {faqs.map((faq) => (
                <details
                  key={faq.q}
                  className="group rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] p-6 open:bg-[color:var(--color-surface)]"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-[color:var(--color-text)]">
                    {faq.q}
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--color-primary-bg)] text-[color:var(--color-primary)] transition-transform group-open:rotate-45">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="6" y1="1" x2="6" y2="11" />
                        <line x1="1" y1="6" x2="11" y2="6" />
                      </svg>
                    </span>
                  </summary>
                  <p className="mt-4 text-base leading-relaxed text-[color:var(--color-text-secondary)]">
                    {faq.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </Section>

        <CtaBand
          eyebrow="Ready to stop dreading homework?"
          headline="Try Veradic free."
          subhead="No credit card. Start with one problem. See how it feels."
          primaryLabel="Get started free"
          primaryHref="/register"
          secondaryLabel="Contact us"
          secondaryHref="mailto:support@veradicai.com"
        />
      </main>
      <Footer />
    </>
  );
}
