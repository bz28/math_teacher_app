import Link from "next/link";
import { LogoMark } from "@/components/shared/logo-mark";

export function Footer() {
  return (
    <footer className="border-t border-border-light px-6 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-4">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5">
              <LogoMark size={28} />
              <span className="text-base font-semibold text-text-primary">Veradic AI</span>
            </div>
            <p className="mt-3 text-sm text-text-muted leading-relaxed">
              Veradic breaks any math or science problem into steps you actually understand.
            </p>
          </div>

          {/* Subjects */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-text-primary">Subjects</h3>
            <ul className="space-y-2 text-sm text-text-muted">
              <li>
                <Link href="/subjects/math" className="hover:text-primary transition-colors">
                  Math Tutor
                </Link>
              </li>
              <li>
                <Link href="/subjects/physics" className="hover:text-primary transition-colors">
                  Physics Tutor
                </Link>
              </li>
              <li>
                <Link href="/subjects/chemistry" className="hover:text-primary transition-colors">
                  Chemistry Tutor
                </Link>
              </li>
            </ul>
          </div>

          {/* Product */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-text-primary">Product</h3>
            <ul className="space-y-2 text-sm text-text-muted">
              <li>
                <Link href="/#features" className="hover:text-primary transition-colors">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/#faq" className="hover:text-primary transition-colors">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/teachers" className="hover:text-primary transition-colors">
                  For Schools
                </Link>
              </li>
            </ul>
          </div>

          {/* Get Started */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-text-primary">Get Started</h3>
            <ul className="space-y-2 text-sm text-text-muted">
              <li>
                <Link href="/register" className="hover:text-primary transition-colors">
                  Sign Up Free
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-primary transition-colors">
                  Sign In
                </Link>
              </li>
              <li>
                <Link href="/support" className="hover:text-primary transition-colors">
                  Support
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Legal + Copyright */}
        <div className="mt-10 border-t border-border-light pt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <div className="flex gap-4 text-sm text-text-muted">
            <Link href="/privacy" className="hover:text-primary transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-primary transition-colors">
              Terms of Service
            </Link>
          </div>
          <p className="text-sm text-text-muted">
            &copy; {new Date().getFullYear()} Veradic LLC. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
