import Link from "next/link";
import { LogoMark } from "@/components/shared/logo-mark";

export function Navbar() {
  return (
    <nav className="sticky top-0 z-40 border-b border-[color:var(--color-border-light)]/60 bg-[color:var(--color-surface)]/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 md:h-20 md:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark size={32} />
          <span className="text-base font-bold tracking-tight text-[color:var(--color-text)] md:text-lg">
            Veradic AI
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2 md:gap-3">
          <Link
            href="/login"
            className="text-sm font-semibold text-[color:var(--color-text-secondary)] transition-colors hover:text-[color:var(--color-primary)]"
          >
            Sign In
          </Link>
          <Link
            href="/demo"
            className="rounded-full bg-[color:var(--color-primary)] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[color:var(--color-primary-dark)] md:px-5 md:py-2.5"
          >
            Book a demo
          </Link>
        </div>
      </div>
    </nav>
  );
}
