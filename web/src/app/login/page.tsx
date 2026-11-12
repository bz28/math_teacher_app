"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import { auth as authApi } from "@/lib/api";
import { useToast } from "@/components/ui";
import { AuthShell, AUTH_CARD, AUTH_H1 } from "@/components/site/auth-shell";
import { SiteInput, SitePasswordInput, SiteSubmit, Spinner } from "@/components/site/form";

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
  const { user, login, verifyMfa, cancelMfa, logout, pendingMfa, loading, error, clearError } =
    useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const signedOut = searchParams.get("reason") === "signed_out";
  // Set while this page is signing someone in, so the "already signed
  // in" view doesn't flash between a successful sign-in and the redirect.
  const [signingIn, setSigningIn] = useState(false);
  const alreadySignedIn = !!user && !signingIn && !pendingMfa;
  // AuthProvider is still checking a stored session: show neither the
  // form nor the signed-in card until it knows which is true. `mounted`
  // keeps the server render and the first client render identical (the
  // store can't be read the same way on both).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const checkingSession = !mounted || (loading && !signingIn && !pendingMfa);
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

  // No clearing of stored tokens on arrival. Tabs share them, so this
  // page wiping them signed out every other open tab without a word — a
  // teacher opening Veradic in a second tab lost a grading session that
  // way (prod, 2026-10-18). A stale session is cleared by AuthProvider's
  // own failed refresh; a live one is offered below.

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSigningIn(true);
    try {
      const result = await login(email, password);
      if (result.mfa_required) {
        setSigningIn(false);
        // pendingMfa is now set in the store; the form below switches
        // to the code-entry view. Don't redirect — login is incomplete
        // until verifyMfa succeeds.
        setMfaCode("");
        return;
      }
      redirectAfterLogin();
    } catch {
      setSigningIn(false);
      const msg = useAuthStore.getState().error;
      if (msg) toast.error(msg);
    }
  }

  async function handleVerifyMfa(e: FormEvent) {
    e.preventDefault();
    setSigningIn(true);
    try {
      await verifyMfa(mfaCode);
      redirectAfterLogin();
    } catch {
      setSigningIn(false);
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

  const quietLink =
    "text-sm font-semibold text-ink-soft underline-offset-4 transition-colors hover:text-veradic hover:underline";

  return (
    <AuthShell switchPrompt="New student?" switchLabel="Join your class" switchHref="/register">
      {/* Quiet entrance: opacity + 4px rise, no spring. */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className={AUTH_CARD}
      >
        {checkingSession ? (
          <div className="flex justify-center py-10" role="status" aria-label="Checking your session">
            <Spinner />
          </div>
        ) : alreadySignedIn ? (
          <>
            <h1 className={AUTH_H1}>You&apos;re signed in.</h1>
            <p className="m-0 mt-3 text-base leading-[1.5] text-ink-soft">
              As <strong className="font-bold text-ink">{user.name || user.email}</strong>
              {user.name && <> ({user.email})</>}.
            </p>
            <button
              type="button"
              onClick={redirectAfterLogin}
              className="mt-7 flex w-full items-center justify-center rounded-[6px] bg-veradic px-4 py-4 text-[17px] font-extrabold text-white transition-colors hover:bg-veradic-dark"
            >
              Continue
            </button>
            <button type="button" onClick={logout} className={`mx-auto mt-4 block ${quietLink}`}>
              Use a different account
            </button>
          </>
        ) : pendingMfa ? (
          <>
            <h1 className={AUTH_H1}>Check your email.</h1>
            <p className="m-0 mt-3 text-base leading-[1.5] text-ink-soft">
              We sent a 6-digit code to{" "}
              <strong className="font-bold text-ink">{pendingMfa.email}</strong>.
              Enter it below to finish signing in. The code expires in 10 minutes.
            </p>

            <form onSubmit={handleVerifyMfa} className="mt-6 space-y-5">
              <SiteInput
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
                large
              />

              <SiteSubmit loading={loading} disabled={mfaCode.length !== 6}>
                Verify and sign in
              </SiteSubmit>

              <button type="button" onClick={handleCancelMfa} className={`mx-auto block ${quietLink}`}>
                Use a different account
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className={AUTH_H1}>Welcome back.</h1>
            {signedOut ? (
              <p
                role="status"
                className="m-0 mt-4 rounded-[6px] border border-[#E9C46A] bg-[#FFF6DB] px-3.5 py-2.5 text-sm leading-[1.5] text-[#5C4300]"
              >
                You were signed out. Sign in to go back to where you were, and
                check that your last change saved.
              </p>
            ) : (
              <p className="m-0 mt-2 text-base text-ink-soft">Sign in to continue.</p>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <SiteInput
                label="Email"
                type="email"
                placeholder="you@school.org"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) clearError();
                }}
                required
                autoComplete="email"
              />

              <div>
                <SitePasswordInput
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
                <div className="mt-2 text-right">
                  <button type="button" className={quietLink} onClick={() => setShowForgot(true)}>
                    Forgot password?
                  </button>
                </div>
              </div>

              <SiteSubmit loading={loading}>Sign in</SiteSubmit>
            </form>
          </>
        )}
      </motion.div>

      {/* Forgot password: an ink scrim and a white card. */}
      {showForgot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(29,38,51,0.55)] px-4"
          onClick={() => setShowForgot(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="forgot-title"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="w-full max-w-[420px] rounded-[4px] border border-hairline bg-white px-5 py-7 shadow-[0_30px_60px_-30px_rgba(29,38,51,0.6)] sm:px-8 sm:py-8"
          >
            {forgotSent ? (
              <div className="text-center">
                <span
                  aria-hidden="true"
                  className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border-2 border-veradic text-veradic"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <h2 id="forgot-title" className="m-0 text-[22px] font-black tracking-[-0.02em] text-ink">
                  Check your email
                </h2>
                <p className="m-0 mt-2 text-[15px] leading-[1.5] text-ink-soft">
                  If an account exists for <strong className="font-bold text-ink">{forgotEmail}</strong>, we sent a password reset link.
                </p>
                <button
                  type="button"
                  onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(""); }}
                  className="mt-5 text-[15px] font-bold text-veradic underline underline-offset-4 hover:text-veradic-dark"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <>
                <h2 id="forgot-title" className="m-0 text-[24px] font-black leading-[1.1] tracking-[-0.02em] text-ink">
                  Reset your password
                </h2>
                <p className="m-0 mt-2 text-[15px] leading-[1.5] text-ink-soft">
                  Enter your email and we&apos;ll send you a reset link.
                </p>
                <form onSubmit={handleForgotPassword} className="mt-5 space-y-5">
                  <SiteInput
                    label="Email"
                    id="forgot-email"
                    type="email"
                    placeholder="you@school.org"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                    autoComplete="email"
                    autoFocus
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowForgot(false)}
                      className="flex-1 rounded-[6px] border-[1.5px] border-[#8A93A0] px-4 py-3 text-[15px] font-bold text-ink transition-colors hover:border-ink"
                    >
                      Cancel
                    </button>
                    <div className="flex-1">
                      <SiteSubmit loading={forgotLoading}>Send link</SiteSubmit>
                    </div>
                  </div>
                </form>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AuthShell>
  );
}
