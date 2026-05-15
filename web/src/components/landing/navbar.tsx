import Link from "next/link";
import { LogoMark } from "@/components/shared/logo-mark";

export function Navbar() {
  return (
    <nav className="sticky top-0 z-40 border-b border-[color:var(--color-border-light)] bg-[color:var(--color-surface)]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 md:h-20 md:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark size={32} />
          {/* Brand wordmark + serif-italic sub. Mirrors the dashboard's
              sidebar-brand + sidebar-brand-sub pair so the two apps
              speak the same brand language. */}
          <span className="flex flex-col leading-none">
            <span className="text-base font-bold tracking-[-0.01em] text-[color:var(--color-text)] md:text-lg">
              Veradic AI
            </span>
            <span className="hidden font-serif italic text-[12px] text-[color:var(--color-text-muted)] md:block">
              for teachers
            </span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-3 md:gap-4">
          <Link
            href="/login"
            className="text-sm font-semibold text-[color:var(--color-text-secondary)] transition-colors hover:text-[color:var(--color-primary)]"
          >
            Sign In
          </Link>
          {/* Primary nav CTA leads with the wider funnel — solo teachers
              self-serving. Sharp radius matches the dashboard's button
              family; hero CTAs keep pill. */}
          <Link
            href="/register?role=teacher"
            className="rounded-[--radius-sm] bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold tracking-[0.01em] text-white transition-colors hover:bg-[color:var(--color-primary-dark)] md:px-5 md:py-2.5"
          >
            Start free
          </Link>
        </div>
      </div>
    </nav>
  );
}
