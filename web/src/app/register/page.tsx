"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { auth } from "@/lib/api";
import { Button, useToast } from "@/components/ui";
import { Input, PasswordInput } from "@/components/ui/input";

const GRADE_OPTIONS = [
  { label: "K-2", value: 2 },
  { label: "3-5", value: 5 },
  { label: "6-8", value: 8 },
  { label: "9-12", value: 12 },
  { label: "College", value: 16 },
];

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gradeLevel, setGradeLevel] = useState(8);
  const [emailError, setEmailError] = useState("");
  const { register, loading, error, clearError } = useAuthStore();
  const router = useRouter();
  const toast = useToast();

  async function checkEmail() {
    if (!email) return;
    try {
      const res = await auth.checkEmail(email);
      if (!res.available) {
        setEmailError("This email is already registered");
      } else {
        setEmailError("");
      }
    } catch {
      // Ignore check errors — server will validate on register
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (emailError) return;

    try {
      await register({ email, password, name, grade_level: gradeLevel });
      router.replace("/home");
    } catch {
      const msg = useAuthStore.getState().error;
      if (msg) toast.error(msg);
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
      <div className="w-full max-w-sm rounded-[--radius-xl] border border-border-light bg-surface p-8 shadow-md">
        <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
          Create your account
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Start mastering math and chemistry
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Input
            label="Name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />

          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError("");
              if (error) clearError();
            }}
            onBlur={checkEmail}
            error={emailError}
            required
            autoComplete="email"
          />

          <PasswordInput
            label="Password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) clearError();
            }}
            required
            minLength={8}
            autoComplete="new-password"
          />

          {/* Grade picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold tracking-wide text-text-secondary">
              Grade Level
            </label>
            <div className="flex gap-2">
              {GRADE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setGradeLevel(opt.value)}
                  className={`flex-1 rounded-[--radius-sm] border py-2 text-xs font-semibold transition-colors ${
                    gradeLevel === opt.value
                      ? "border-primary bg-primary-bg text-primary"
                      : "border-border bg-input-bg text-text-secondary hover:border-primary/30"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="submit"
            loading={loading}
            gradient
            className="w-full"
            disabled={!!emailError}
          >
            Create Account
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-text-muted">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-primary hover:text-primary-dark"
          >
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
