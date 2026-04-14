"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { LogoMark } from "@/components/shared/logo-mark";

const primaryLinks = [
  { label: "For Teachers", href: "/for-teachers" },
  { label: "For Students", href: "/students" },
];

const BOOK_DEMO_HREF = "/demo";

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Lock body scroll when mobile menu open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="sticky top-0 z-40 border-b border-[color:var(--color-border-light)]/60 bg-[color:var(--color-surface)]/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center px-6 md:h-20">
        {/* Logo — flex-1 so links can center */}
        <div className="flex flex-1 items-center">
          <Link
            href="/"
            className="flex items-center gap-2.5"
            onClick={() => setMobileOpen(false)}
          >
            <LogoMark size={32} />
            <span className="text-lg font-bold tracking-tight text-[color:var(--color-text)]">
              Veradic AI
            </span>
          </Link>
        </div>

        {/* Desktop links — centered */}
        <div className="hidden items-center gap-8 md:flex">
          {primaryLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-[color:var(--color-primary)] ${
                isActive(link.href)
                  ? "text-[color:var(--color-text)]"
                  : "text-[color:var(--color-text-secondary)]"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop CTAs — flex-1 right-aligned */}
        <div className="hidden flex-1 items-center justify-end gap-3 md:flex">
          <Link
            href="/login"
            className="text-sm font-semibold text-[color:var(--color-text-secondary)] transition-colors hover:text-[color:var(--color-primary)]"
          >
            Sign In
          </Link>
          <Link
            href={BOOK_DEMO_HREF}
            className="rounded-full bg-[color:var(--color-primary)] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[color:var(--color-primary-dark)]"
          >
            Book a demo
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="flex h-10 w-10 items-center justify-center rounded-lg text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-primary-bg)] md:hidden"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {mobileOpen ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile full-screen overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 top-16 z-30 flex flex-col bg-[color:var(--color-surface)] md:hidden"
          >
            <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-6 py-6">
              {primaryLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-xl px-4 py-3 text-base font-medium text-[color:var(--color-text)] hover:bg-[color:var(--color-primary-bg)]"
                >
                  {link.label}
                </Link>
              ))}

              <hr className="my-4 border-[color:var(--color-border-light)]" />

              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl px-4 py-3 text-base font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-primary-bg)]"
              >
                Sign In
              </Link>

            </div>

            {/* Pinned CTA at bottom */}
            <div className="border-t border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-6">
              <Link
                href={BOOK_DEMO_HREF}
                onClick={() => setMobileOpen(false)}
                className="block rounded-full bg-[color:var(--color-primary)] px-6 py-4 text-center text-base font-bold text-white transition-colors hover:bg-[color:var(--color-primary-dark)]"
              >
                Book a demo
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
