import Link from "next/link";
import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

export function HomeStudents() {
  return (
    <Section variant="alt">
      <div className="mx-auto max-w-2xl text-center">
        <Eyebrow>For students</Eyebrow>
        <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
          Stuck on homework?
          <br />
          Veradic walks you through it — not past it.
        </h2>
        <p className="mt-6 text-lg leading-relaxed text-[color:var(--color-text-secondary)]">
          Snap a picture of any problem. Veradic breaks it into steps and
          asks you the right questions until you figure it out yourself. You
          get to the answer — and you actually know how you got there.
        </p>
        <Link
          href="/students"
          className="mt-10 inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-7 py-3 text-base font-semibold text-[color:var(--color-text)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
        >
          Get the student app
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </Section>
  );
}
