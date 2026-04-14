"use client";

import { Suspense, useState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import { clearTokens, auth as authApi } from "@/lib/api";
import { Button, useToast } from "@/components/ui";
import { Input, PasswordInput } from "@/components/ui/input";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const { login, loading, error, clearError } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const toast = useToast();

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
      await login(email, password);
      const user = useAuthStore.getState().user;
      const dest =
        redirect && redirect.startsWith("/")
          ? redirect
          : user?.role === "teacher"
            ? "/school/teacher"
            : user?.role === "student" && user.school_id
              ? "/school/student"
              : "/home";
      router.replace(dest);
    } catch {
      const msg = useAuthStore.getState().error;
      if (msg) toast.error(msg);
    }
  }

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-12">
      {/* Background gradient mesh */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/4 top-1/4 h-[400px] w-[400px] rounded-full bg-gradient-to-br from-primary/6 to-transparent blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 h-[300px] w-[300px] rounded-full bg-gradient-to-br from-primary-light/5 to-transparent blur-3xl" />
      </div>

      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <Link href="/" className="mb-8 flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-[--radius-md] bg-gradient-to-br from-primary to-primary-light">
            <span className="text-base font-extrabold text-white">V</span>
          </div>
          <span className="text-xl font-bold tracking-tight text-text-primary">
            Veradic AI
          </span>
        </Link>
      </motion.div>

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 25 }}
        className="relative w-full max-w-sm rounded-[--radius-xl] border border-border-light bg-surface p-8 shadow-md"
      >
        <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Sign in to continue learning
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
            gradient
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
      </motion.div>

      {/* Forgot password overlay */}
      {showForgot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={() => setShowForgot(false)}>
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-sm rounded-[--radius-xl] border border-border-light bg-surface p-8 shadow-lg"
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
                <h3 className="text-lg font-bold text-text-primary">Reset your password</h3>
                <p className="mt-1 text-sm text-text-secondary">
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
                      className="flex-1 rounded-[--radius-md] border border-border px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:border-primary/30"
                    >
                      Cancel
                    </button>
                    <Button type="submit" loading={forgotLoading} gradient className="flex-1">
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
