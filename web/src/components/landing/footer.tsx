import Link from "next/link";
import { Logo } from "@/components/site/logo";

type LinkItem = { label: string; href: string };

// "Classroom" = the teacher-led, in-school product (the homepage pitch +
// /for-districts + book-a-demo). There is no self-study column: Veradic is
// invite-only, so students join through their teacher's class.
const classroomLinks: LinkItem[] = [
  { label: "For districts", href: "/for-districts" },
  { label: "Book a demo", href: "/demo" },
];

const subjectsLinks: LinkItem[] = [
  { label: "Math", href: "/subjects/math" },
  { label: "Physics", href: "/subjects/physics" },
  { label: "Chemistry", href: "/subjects/chemistry" },
];

// No "Create account" — Veradic is sold to schools; teachers arrive via a
// school invite and prospects book a demo. Students join with their
// teacher's class code.
const accountLinks: LinkItem[] = [
  { label: "Sign in", href: "/login" },
  { label: "Book a demo", href: "/demo" },
  { label: "Support", href: "/support" },
];

const legalLinks: LinkItem[] = [
  { label: "Trust & security", href: "/trust" },
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
      {/* Sentence-case, bold ink: a label that names the group, not a
          tracked-out caps eyebrow. */}
      <h2 className="mb-4 text-[15px] font-extrabold text-ink">{heading}</h2>
      <ul className="space-y-3 text-[15px]">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-ink-soft transition-colors hover:text-veradic hover:underline hover:underline-offset-4"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The marketing footer, shared by every marketing page. Like the navbar it
 * carries `site` itself, so it has the notebook look on pages that haven't
 * moved over yet. Plain paper, no grid: the page ends quietly.
 */
export function Footer() {
  return (
    <footer className="site border-t border-hairline bg-paper">
      <div className="mx-auto max-w-[1200px] px-4 py-14 md:px-8 md:py-16">
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 md:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div className="sm:col-span-2 md:col-span-1 md:pr-8">
            <Logo />
            <p className="mt-5 max-w-xs text-[15px] leading-relaxed text-ink-soft">
              Classroom AI that reads the work, checks who understands,
              drafts the grading, and gives every student more practice
              than you have time to write.
            </p>
          </div>

          {/* Classroom first since it's the primary conversion path;
              Subjects supporting; then utility. */}
          <FooterColumn heading="Classroom" links={classroomLinks} />
          <FooterColumn heading="Subjects" links={subjectsLinks} />
          <FooterColumn heading="Account" links={accountLinks} />
          <FooterColumn heading="Legal" links={legalLinks} />
        </div>

        <div className="mt-14 flex flex-col items-start gap-3 border-t border-hairline pt-8 text-sm text-ink-soft md:flex-row md:items-center md:justify-between">
          <p>&copy; {new Date().getFullYear()} Veradic LLC. All rights reserved.</p>
          <p>Made for classrooms in the United States.</p>
        </div>
      </div>
    </footer>
  );
}
