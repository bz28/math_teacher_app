import Link from "next/link";
import { LogoMark } from "@/components/shared/logo-mark";

type LinkItem = { label: string; href: string };

const productLinks: LinkItem[] = [
  { label: "For Students", href: "/students" },
  { label: "Math", href: "/subjects/math" },
  { label: "Physics", href: "/subjects/physics" },
  { label: "Chemistry", href: "/subjects/chemistry" },
];

const companyLinks: LinkItem[] = [
  { label: "Safety", href: "/safety" },
  { label: "Book a demo", href: "/demo" },
];

const resourceLinks: LinkItem[] = [
  { label: "Support", href: "/support" },
  { label: "Sign in", href: "/login" },
  { label: "Create account", href: "/register" },
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
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-[color:var(--color-text-muted)]">
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
        <div className="grid gap-12 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div className="md:pr-8">
            <div className="flex items-center gap-2.5">
              <LogoMark size={32} />
              <span className="text-lg font-bold tracking-tight text-[color:var(--color-text)]">
                Veradic AI
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[color:var(--color-text-secondary)]">
              The AI tutor that teaches instead of telling. Built for schools, loved by teachers.
            </p>
          </div>

          <FooterColumn heading="Product" links={productLinks} />
          <FooterColumn heading="Company" links={companyLinks} />
          <FooterColumn heading="Resources" links={resourceLinks} />
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
