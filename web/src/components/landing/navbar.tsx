"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LogoMark } from "@/components/shared/logo-mark";

const featureLinks = [
  { label: "Step-by-Step Learning", href: "#step-by-step" },
  { label: "Chat With Your Tutor", href: "#chat-tutor" },
  { label: "Unlimited Practice", href: "#practice" },
];

const teacherNavLinks = [
  { label: "How It Helps", href: "#outcomes" },
  { label: "Contact", href: "#contact" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const isTeacherPage = pathname === "/teachers";

  const ctaLabel = isTeacherPage ? "Request a Demo" : "Get Started";
  const ctaHref = isTeacherPage ? "#contact" : "/register";

  // Close dropdown on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setFeaturesOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <nav className="sticky top-0 z-40 border-b border-border-light/50 bg-surface/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        {/* Logo */}
        <Link
          href="/"
          onClick={(e) => {
            if (pathname === "/") {
              e.preventDefault();
              // Override CSS scroll-behavior: smooth for instant jump
              document.documentElement.style.scrollBehavior = "auto";
              window.scrollTo({ top: 0 });
              document.documentElement.style.scrollBehavior = "";
            }
          }}
          className="flex items-center gap-2.5"
        >
          <LogoMark size={32} />
          <span className="text-lg font-bold tracking-tight text-text-primary">
            Veradic AI
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-8 md:flex">
          {isTeacherPage ? (
            teacherNavLinks.map((link) =>
              link.href.startsWith("#") ? (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-text-secondary transition-colors hover:text-primary"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-text-secondary transition-colors hover:text-primary"
                >
                  {link.label}
                </Link>
              )
            )
          ) : (
            <>
              {/* Features dropdown */}
              <div ref={dropdownRef} className="relative">
                <button
                  onClick={() => setFeaturesOpen((o) => !o)}
                  className="flex items-center gap-1 text-sm font-medium text-text-secondary transition-colors hover:text-primary focus:outline-none"
                >
                  Features
                  <svg
                    className={`h-3.5 w-3.5 transition-transform ${featuresOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <AnimatePresence>
                  {featuresOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-0 top-full mt-2 w-56 rounded-[--radius-md] border border-border-light bg-surface py-2 shadow-lg"
                    >
                      {featureLinks.map((link) => (
                        <a
                          key={link.href}
                          href={link.href}
                          onClick={() => setFeaturesOpen(false)}
                          className="block px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-primary-bg hover:text-primary"
                        >
                          {link.label}
                        </a>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <Link
                href="/teachers"
                className="text-sm font-medium text-text-secondary transition-colors hover:text-primary"
              >
                For Schools
              </Link>
            </>
          )}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
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
              {isTeacherPage ? (
                teacherNavLinks.map((link) =>
                  link.href.startsWith("#") ? (
                    <a
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className="rounded-[--radius-sm] px-3 py-2 text-sm font-medium text-text-secondary hover:bg-primary-bg hover:text-primary"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className="rounded-[--radius-sm] px-3 py-2 text-sm font-medium text-text-secondary hover:bg-primary-bg hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  )
                )
              ) : (
                <>
                  <p className="px-3 py-1 text-xs font-semibold text-text-muted">Features</p>
                  {featureLinks.map((link) => (
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
                    href="/teachers"
                    onClick={() => setMobileOpen(false)}
                    className="rounded-[--radius-sm] px-3 py-2 text-sm font-medium text-text-secondary hover:bg-primary-bg hover:text-primary"
                  >
                    For Schools
                  </Link>
                </>
              )}
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
