import Link from "next/link";
import { LogoMark } from "@/components/shared/logo-mark";

type LinkItem = { label: string; href: string };

// Plan-based grouping: Schools (institutional, teacher-led) vs.
// Personal (individual student, no teacher). The columns now carry
// real meaning instead of audience-mixing the way "Product" did.
//
// Schools column also holds the "Book a demo" CTA — it's the
// school-plan conversion link, so it belongs with the rest of the
// school-plan surfaces, not in its own floating column.
const schoolsLinks: LinkItem[] = [
  { label: "For Districts", href: "/for-districts" },
  { label: "Book a demo", href: "/demo" },
];

const personalLinks: LinkItem[] = [
  { label: "For Students", href: "/students" },
];

const subjectsLinks: LinkItem[] = [
  { label: "Math", href: "/subjects/math" },
  { label: "Physics", href: "/subjects/physics" },
  { label: "Chemistry", href: "/subjects/chemistry" },
];

const accountLinks: LinkItem[] = [
  { label: "Sign in", href: "/login" },
  { label: "Create account", href: "/register" },
  { label: "Support", href: "/support" },
];

const legalLinks: LinkItem[] = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: LinkItem[];
}) {
  return (
    <div>
      {/* Dashboard-parity small caps: 11px / 600 / 0.18em tracking,
          on --color-text-secondary so it passes AA at this small size. */}
      <h3 className="mb-4 font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
        {heading}
      </h3>
      <ul className="space-y-3 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-[color:var(--color-text-secondary)] transition-colors hover:text-[color:var(--color-primary)]"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-[color:var(--color-border-light)] bg-[color:var(--color-surface)]">
      <div className="mx-auto max-w-6xl px-6 py-16 md:px-8 md:py-20">
        <div className="grid gap-x-8 gap-y-12 md:grid-cols-[1.5fr_repeat(5,1fr)]">
          {/* Brand — wordmark + italic-serif tagline mirrors the
              dashboard brand block. */}
          <div className="md:pr-8">
            <div className="flex items-center gap-2.5">
              <LogoMark size={32} />
              <span className="flex flex-col leading-none">
                <span className="text-lg font-bold tracking-[-0.01em] text-[color:var(--color-text)]">
                  Veradic AI
                </span>
                <span className="mt-1 font-serif italic text-[13px] text-[color:var(--color-text-muted)]">
                  classroom AI, teacher-controlled
                </span>
              </span>
            </div>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-[color:var(--color-text-secondary)]">
              Classroom AI that catches the work, drafts the grading,
              and gives every student more practice than you have time
              to write.
            </p>
          </div>

          {/* Plan-based grouping: Schools first (the institutional
              path with district + book-a-demo CTA), Personal next
              (the consumer/student-on-their-own path), Subjects as
              supporting content, then utility columns. */}
          <FooterColumn heading="Schools" links={schoolsLinks} />
          <FooterColumn heading="Personal" links={personalLinks} />
          <FooterColumn heading="Subjects" links={subjectsLinks} />
          <FooterColumn heading="Account" links={accountLinks} />
          <FooterColumn heading="Legal" links={legalLinks} />
        </div>

        {/* Bottom bar */}
        <div className="mt-16 flex flex-col items-start gap-4 border-t border-[color:var(--color-border-light)] pt-8 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-[color:var(--color-text-muted)]">
            &copy; {new Date().getFullYear()} Veradic LLC. All rights reserved.
          </p>
          <p className="text-xs text-[color:var(--color-text-muted)]">
            Made for classrooms in the United States.
          </p>
        </div>
      </div>
    </footer>
  );
}
