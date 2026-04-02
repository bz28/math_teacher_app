"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { auth } from "@/lib/api";
import { Button, useToast } from "@/components/ui";
import { PasswordInput } from "@/components/ui/input";

export default function SetPasswordPage() {
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
          <h1 className="text-xl font-bold text-text-primary">Invalid Link</h1>
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
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-sm rounded-[--radius-xl] border border-green-200 bg-green-50 p-8 text-center dark:border-green-500/20 dark:bg-green-500/5"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/10">
            <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-text-primary">Password Set!</h2>
          <p className="mt-2 text-sm text-text-secondary">You can now log in with your new password.</p>
          <Link
            href="/login"
            className="mt-6 inline-flex h-10 items-center justify-center rounded-[--radius-md] bg-gradient-to-r from-primary to-primary-light px-6 text-sm font-bold text-white"
          >
            Go to Login
          </Link>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm rounded-[--radius-xl] border border-border-light bg-surface p-8 shadow-md"
      >
        <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
          Set Your Password
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
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
          <Button type="submit" loading={loading} gradient className="w-full">
            Set Password
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
