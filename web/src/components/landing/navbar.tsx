"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Subjects", href: "#subjects" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-40 border-b border-border-light/50 bg-white/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark />
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
          <Link
            href="/login"
            className="text-sm font-semibold text-text-secondary transition-colors hover:text-primary"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="rounded-[--radius-pill] bg-primary px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark"
          >
            Get Started
          </Link>
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
              <hr className="my-2 border-border-light" />
              <Link
                href="/login"
                className="rounded-[--radius-sm] px-3 py-2 text-sm font-medium text-text-secondary hover:bg-primary-bg"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="mt-1 rounded-[--radius-pill] bg-primary px-5 py-2.5 text-center text-sm font-bold text-white"
              >
                Get Started
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-[--radius-sm] bg-gradient-to-br from-primary to-primary-light">
      <span className="text-sm font-extrabold text-white">V</span>
    </div>
  );
}
