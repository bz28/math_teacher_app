"use client";

import { Suspense, useState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import { clearTokens, auth as authApi } from "@/lib/api";
import { Button, useToast } from "@/components/ui";
import { Input, PasswordInput } from "@/components/ui/input";
import { LogoMark } from "@/components/shared/logo-mark";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}

// Accept only same-origin redirects. URL parsing handles every weird
// case (protocol-relative //host, backslashes Chrome normalizes to /,
// encoded slashes, authority injection) without regex whack-a-mole.
function sameOriginRedirect(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

function LoginPageContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const { login, verifyMfa, cancelMfa, pendingMfa, loading, error, clearError } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const toast = useToast();

  function redirectAfterLogin() {
    const user = useAuthStore.getState().user;
    const dest =
      sameOriginRedirect(redirect) ??
      (user?.role === "teacher"
        ? "/school/teacher"
        : user?.role === "student" && user.school_id
          ? "/school/student"
          : "/home");
    router.replace(dest);
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    setForgotLoading(true);
    try {
      await authApi.forgotPassword(forgotEmail);
      setForgotSent(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  }

  // Clear stale tokens so loadUser() doesn't fire "Session expired"
  useEffect(() => {
    clearTokens();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const result = await login(email, password);
      if (result.mfa_required) {
        // pendingMfa is now set in the store; the form below switches
        // to the code-entry view. Don't redirect — login is incomplete
        // until verifyMfa succeeds.
        setMfaCode("");
        return;
      }
      redirectAfterLogin();
    } catch {
      const msg = useAuthStore.getState().error;
      if (msg) toast.error(msg);
    }
  }

  async function handleVerifyMfa(e: FormEvent) {
    e.preventDefault();
    try {
      await verifyMfa(mfaCode);
      redirectAfterLogin();
    } catch {
      const msg = useAuthStore.getState().error;
      if (msg) toast.error(msg);
      // If pendingMfa got cleared by the store (fatal verify error
      // like expired or too-many-attempts), the next render will fall
      // back to the password form automatically. Reset local code
      // state either way so a stale value doesn't carry over.
      setMfaCode("");
    }
  }

  function handleCancelMfa() {
    cancelMfa();
    setMfaCode("");
    setPassword("");
  }

  return (
    <div
      className="relative flex flex-1 flex-col items-center justify-center px-6 py-12"
      style={{
        // Editorial signin backdrop matching the dashboard .login-page
        // pattern: warm-paper radial atmosphere, no orbs, no blur halos.
        backgroundImage:
          "radial-gradient(circle at 18% 22%, var(--color-surface-alt-2) 0%, transparent 38%)," +
          "radial-gradient(circle at 82% 78%, var(--color-primary-bg) 0%, transparent 40%)",
      }}
    >
      {/* Brand — wordmark + serif-italic sub, matching the dashboard
          and homepage brand block. No gradient logo tile. */}
      <Link href="/" className="mb-10 flex items-center gap-2.5">
        <LogoMark size={36} />
        <span className="flex flex-col leading-none">
          <span className="text-lg font-bold tracking-[-0.01em] text-text-primary">
            Veradic AI
          </span>
          <span className="mt-1 font-serif italic text-[13px] text-text-muted">
            classroom AI, teacher-controlled
          </span>
        </span>
      </Link>

      {/* Card — hairline on warm surface, no shadow chrome.
          Quieter entrance: opacity + 4px rise, no spring. */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="relative w-full max-w-sm rounded-[--radius-md] border border-border bg-surface p-8"
      >
        {pendingMfa ? (
          <>
            <h1 className="font-serif text-[28px] leading-tight tracking-[-0.01em] text-text-primary">
              Check your email.
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              We sent a 6-digit code to{" "}
              <strong className="text-text-primary">{pendingMfa.email}</strong>.
              Enter it below to finish signing in. The code expires in 10 minutes.
            </p>

            <form onSubmit={handleVerifyMfa} className="mt-6 space-y-4">
              <Input
                label="Sign-in code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="123456"
                value={mfaCode}
                onChange={(e) => {
                  // Strip non-digits so paste of "123 456" still works.
                  setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  if (error) clearError();
                }}
                required
                autoComplete="one-time-code"
                autoFocus
              />

              <Button
                type="submit"
                loading={loading}
                disabled={mfaCode.length !== 6}
                className="w-full"
              >
                Verify and sign in
              </Button>

              <button
                type="button"
                onClick={handleCancelMfa}
                className="block w-full text-center text-xs font-medium text-text-muted transition-colors hover:text-primary"
              >
                ← Use a different account
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="font-serif text-[28px] leading-tight tracking-[-0.01em] text-text-primary">
              Welcome back.
            </h1>
            <p className="mt-2 font-serif italic text-[15px] text-text-secondary">
              Sign in to continue.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <Input
                label="Email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) clearError();
                }}
                required
                autoComplete="email"
              />

              <div>
                <PasswordInput
                  label="Password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) clearError();
                  }}
                  required
                  autoComplete="current-password"
                />
                <div className="mt-1.5 text-right">
                  <button
                    type="button"
                    className="text-xs font-medium text-text-muted transition-colors hover:text-primary"
                    onClick={() => setShowForgot(true)}
                  >
                    Forgot password?
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                loading={loading}
                className="w-full"
              >
                Sign In
              </Button>
            </form>

            <div className="mt-6 border-t border-border-light pt-4 text-center">
              <p className="text-sm text-text-secondary">
                Don&apos;t have an account?{" "}
                <Link
                  href="/register"
                  className="font-semibold text-primary hover:text-primary-dark"
                >
                  Get Started
                </Link>
              </p>
            </div>
          </>
        )}
      </motion.div>

      {/* Forgot password overlay — warm-ink scrim, hairline card. */}
      {showForgot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--color-overlay)] px-6" onClick={() => setShowForgot(false)}>
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="w-full max-w-sm rounded-[--radius-md] border border-border bg-surface p-8 shadow-md"
          >
            {forgotSent ? (
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/10">
                  <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-text-primary">Check your email</h3>
                <p className="mt-2 text-sm text-text-secondary">
                  If an account exists for <strong>{forgotEmail}</strong>, we sent a password reset link.
                </p>
                <button
                  onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(""); }}
                  className="mt-4 text-sm font-semibold text-primary hover:text-primary-dark"
                >
                  Back to Login
                </button>
              </div>
            ) : (
              <>
                <h3 className="font-serif text-[22px] leading-tight tracking-[-0.01em] text-text-primary">
                  Reset your password
                </h3>
                <p className="mt-2 text-sm text-text-secondary">
                  Enter your email and we&apos;ll send you a reset link.
                </p>
                <form onSubmit={handleForgotPassword} className="mt-4 space-y-4">
                  <Input
                    label="Email"
                    type="email"
                    placeholder="you@example.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowForgot(false)}
                      className="flex-1 rounded-[--radius-sm] border border-border px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:border-text-primary hover:text-text-primary"
                    >
                      Cancel
                    </button>
                    <Button type="submit" loading={forgotLoading} className="flex-1">
                      Send Link
                    </Button>
                  </div>
                </form>
              </>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
