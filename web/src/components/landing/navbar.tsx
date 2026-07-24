import Link from "next/link";
import { LogoMark } from "@/components/shared/logo-mark";

export function Navbar() {
  return (
    <nav className="sticky top-0 z-40 border-b border-[color:var(--color-border-light)] bg-[color:var(--color-surface)]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 md:h-20 md:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark size={32} />
          {/* Wordmark alone — the audience-named italic sub ("for
              teachers") was inconsistent with the product-mode
              labels in the footer (Classroom / Self-study) and was
              doing tagline work that doesn't belong in nav chrome.
              The footer keeps "classroom AI, teacher-controlled"
              where a tagline can breathe. */}
          <span className="text-base font-bold tracking-[-0.01em] text-[color:var(--color-text)] md:text-lg">
            Veradic AI
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-3 md:gap-4">
          {/* Plain anchor, not next/link — /tour is the static product tour
              (built from demo/ into public/tour), served via a rewrite, not a
              Next route, so it needs a full navigation. */}
          <a
            href="/tour"
            className="hidden text-sm font-semibold text-[color:var(--color-text-secondary)] transition-colors hover:text-[color:var(--color-primary)] sm:inline"
          >
            Tour
          </a>
          <Link
            href="/login"
            className="text-sm font-semibold text-[color:var(--color-text-secondary)] transition-colors hover:text-[color:var(--color-primary)]"
          >
            Sign In
          </Link>
          {/* Veradic is sold to schools — teachers don't self-serve. The
              primary CTA books a walkthrough; existing school users sign in.
              Sharp radius matches the dashboard's button family. */}
          <Link
            href="/demo"
            className="rounded-[--radius-sm] bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold tracking-[0.01em] text-white transition-colors hover:bg-[color:var(--color-primary-dark)] md:px-5 md:py-2.5"
          >
            Book a demo
          </Link>
        </div>
      </div>
    </nav>
  );
}
