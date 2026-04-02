"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LogoMark } from "@/components/shared/logo-mark";

const studentNavLinks = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Subjects", href: "#subjects" },
];

const teacherNavLinks = [
  { label: "How It Helps", href: "#outcomes" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Contact", href: "#contact" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const isTeacherPage = pathname === "/teachers";

  const navLinks = isTeacherPage ? teacherNavLinks : studentNavLinks;
  const toggleLabel = isTeacherPage ? "For Students" : "For Schools";
  const toggleHref = isTeacherPage ? "/" : "/teachers";
  const ctaLabel = isTeacherPage ? "Request a Demo" : "Get Started";
  const ctaHref = isTeacherPage ? "#contact" : "/register";

  return (
    <nav className="sticky top-0 z-40 border-b border-border-light/50 bg-surface/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark size={32} />
          <span className="text-lg font-bold tracking-tight text-text-primary">
            Veradic AI
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-text-secondary transition-colors hover:text-primary"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <Link
            href={toggleHref}
            className="rounded-[--radius-pill] border border-primary/30 bg-primary-bg px-4 py-1.5 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-primary hover:text-white"
          >
            {toggleLabel}
          </Link>
          <Link
            href="/login"
            className="text-sm font-semibold text-text-secondary transition-colors hover:text-primary"
          >
            Sign In
          </Link>
          {isTeacherPage ? (
            <a
              href={ctaHref}
              className="rounded-[--radius-pill] bg-primary px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark"
            >
              {ctaLabel}
            </a>
          ) : (
            <Link
              href={ctaHref}
              className="rounded-[--radius-pill] bg-primary px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark"
            >
              {ctaLabel}
            </Link>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="flex h-10 w-10 items-center justify-center rounded-[--radius-sm] text-text-secondary hover:bg-primary-bg md:hidden"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {mobileOpen ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-border-light md:hidden"
          >
            <div className="flex flex-col gap-1 px-6 py-4">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-[--radius-sm] px-3 py-2 text-sm font-medium text-text-secondary hover:bg-primary-bg hover:text-primary"
                >
                  {link.label}
                </a>
              ))}
              <Link
                href={toggleHref}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 rounded-[--radius-sm] px-3 py-2 text-sm font-semibold text-primary hover:bg-primary-bg"
              >
                {isTeacherPage ? (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
                  </svg>
                )}
                {toggleLabel}
              </Link>
              <hr className="my-2 border-border-light" />
              <Link
                href="/login"
                className="rounded-[--radius-sm] px-3 py-2 text-sm font-medium text-text-secondary hover:bg-primary-bg"
              >
                Sign In
              </Link>
              {isTeacherPage ? (
                <a
                  href={ctaHref}
                  onClick={() => setMobileOpen(false)}
                  className="mt-1 rounded-[--radius-pill] bg-primary px-5 py-2.5 text-center text-sm font-bold text-white"
                >
                  {ctaLabel}
                </a>
              ) : (
                <Link
                  href={ctaHref}
                  className="mt-1 rounded-[--radius-pill] bg-primary px-5 py-2.5 text-center text-sm font-bold text-white"
                >
                  {ctaLabel}
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
