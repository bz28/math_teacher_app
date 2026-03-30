"use client";

import { useState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import { clearTokens } from "@/lib/api";
import { Button, useToast } from "@/components/ui";
import { Input, PasswordInput } from "@/components/ui/input";

const ERROR_MAP: Record<string, string> = {
  "Account temporarily locked": "Too many failed attempts. Try again in 15 minutes.",
};

function friendlyError(msg: string): string {
  return ERROR_MAP[msg] ?? msg;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login, loading, error, clearError } = useAuthStore();
  const router = useRouter();
  const toast = useToast();

  // Clear stale tokens so loadUser() doesn't fire "Session expired"
  useEffect(() => {
    clearTokens();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await login(email, password);
      router.replace("/home");
    } catch {
      const msg = useAuthStore.getState().error;
      if (msg) toast.error(friendlyError(msg));
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
                onClick={() => toast.info("Password reset coming soon")}
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
    </div>
  );
}
