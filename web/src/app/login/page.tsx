"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui";
import { Input, PasswordInput } from "@/components/ui/input";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login, loading, error, clearError } = useAuthStore();
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await login(email, password);
      router.replace("/home");
    } catch {
      // Error is set in the store
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      {/* Logo */}
      <Link href="/" className="mb-8 flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-[--radius-md] bg-gradient-to-br from-primary to-primary-light">
          <span className="text-base font-extrabold text-white">V</span>
        </div>
        <span className="text-xl font-bold tracking-tight text-text-primary">
          Veradic AI
        </span>
      </Link>

      {/* Card */}
      <div className="w-full max-w-sm rounded-[--radius-xl] border border-border-light bg-white p-8 shadow-md">
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

          {error && (
            <p className="rounded-[--radius-sm] bg-error-light px-3 py-2 text-sm font-medium text-error">
              {error}
            </p>
          )}

          <Button
            type="submit"
            loading={loading}
            gradient
            className="w-full"
          >
            Sign In
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-text-muted">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="font-semibold text-primary hover:text-primary-dark"
          >
            Get Started
          </Link>
        </p>
      </div>
    </div>
  );
}
