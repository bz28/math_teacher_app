"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { auth } from "@/lib/api";
import { Button, useToast } from "@/components/ui";
import { PasswordInput } from "@/components/ui/input";

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center"><p className="text-text-secondary">Loading...</p></div>}>
      <SetPasswordContent />
    </Suspense>
  );
}

function SetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const toast = useToast();

  if (!token) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="text-center">
          <h1 className="font-serif text-[24px] leading-tight tracking-[-0.01em] text-text-primary">Invalid link.</h1>
          <p className="mt-2 text-sm text-text-secondary">
            This link is missing a token. Please check your email for the correct link.
          </p>
          <Link href="/login" className="mt-4 inline-block text-sm font-semibold text-primary hover:text-primary-dark">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await auth.setPassword(token!, password);
      setDone(true);
    } catch (err) {
      toast.error((err as Error).message || "Failed to set password");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="w-full max-w-sm rounded-[--radius-md] border border-[color:var(--color-success-border)] bg-[color:var(--color-success-light)] p-8 text-center"
        >
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="font-serif text-[24px] leading-tight text-text-primary">Password set.</h2>
          <p className="mt-2 text-sm text-text-secondary">You can now log in with your new password.</p>
          <Link
            href="/login"
            className="mt-6 inline-flex h-10 items-center justify-center rounded-[--radius-sm] bg-primary px-6 text-sm font-semibold tracking-[0.01em] text-white hover:bg-primary-dark"
          >
            Go to Login
          </Link>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-1 items-center justify-center px-6 py-12"
      style={{
        backgroundImage:
          "radial-gradient(circle at 18% 22%, var(--color-surface-alt-2) 0%, transparent 38%)," +
          "radial-gradient(circle at 82% 78%, var(--color-primary-bg) 0%, transparent 40%)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="w-full max-w-sm rounded-[--radius-md] border border-border bg-surface p-8"
      >
        <h1 className="font-serif text-[28px] leading-tight tracking-[-0.01em] text-text-primary">
          Set your password.
        </h1>
        <p className="mt-2 font-serif italic text-[15px] text-text-secondary">
          Choose a password for your account.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <PasswordInput
            label="New Password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
          <PasswordInput
            label="Confirm Password"
            placeholder="Type it again"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
          <Button type="submit" loading={loading} className="w-full">
            Set Password
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
