"use client";

import { Suspense, useState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import { auth, clearTokens, type InviteData } from "@/lib/api";
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
  return (
    <Suspense>
      <RegisterPageContent />
    </Suspense>
  );
}

function RegisterPageContent() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gradeLevel, setGradeLevel] = useState(8);
  const [emailError, setEmailError] = useState("");
  const [checkingEmail, setCheckingEmail] = useState(false);
  const { register, loading, error, clearError } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  // Invite flow
  const inviteToken = searchParams.get("invite");
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [inviteLoading, setInviteLoading] = useState(!!inviteToken);
  const [inviteError, setInviteError] = useState("");

  // Clear stale tokens so loadUser() doesn't fire "Session expired"
  useEffect(() => {
    clearTokens();
  }, []);

  // Validate invite token on mount
  useEffect(() => {
    if (!inviteToken) return;
    setInviteLoading(true);
    auth
      .validateInvite(inviteToken)
      .then((data) => {
        setInvite(data);
        setEmail(data.email);
      })
      .catch(() => {
        setInviteError("This invite link is invalid or has expired.");
      })
      .finally(() => setInviteLoading(false));
  }, [inviteToken]);

  async function checkEmail() {
    if (!email || invite) return;
    setCheckingEmail(true);
    try {
      const res = await auth.checkEmail(email);
      if (!res.available) {
        setEmailError("This email is already registered");
      } else {
        setEmailError("");
      }
    } catch {
      // Ignore check errors — server will validate on register
    } finally {
      setCheckingEmail(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (emailError) return;

    try {
      await register({
        email,
        password,
        name,
        grade_level: gradeLevel,
        ...(inviteToken ? { invite_token: inviteToken } : {}),
      });
      router.replace(invite ? "/teacher" : "/home");
    } catch {
      const msg = useAuthStore.getState().error;
      if (msg) toast.error(msg);
    }
  }

  // Invite loading state
  if (inviteToken && inviteLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-text-secondary">Verifying your invite...</p>
        </div>
      </div>
    );
  }

  // Invite error state
  if (inviteToken && inviteError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-[--radius-xl] border border-border-light bg-surface p-8 text-center shadow-md"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/10">
            <svg className="h-7 w-7 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-text-primary">Invite Not Valid</h1>
          <p className="mt-2 text-sm text-text-secondary">{inviteError}</p>
          <p className="mt-4 text-sm text-text-secondary">
            Contact your school administrator to request a new invite.
          </p>
          <Link href="/" className="mt-6 inline-block text-sm font-semibold text-primary hover:text-primary-dark">
            Back to Home
          </Link>
        </motion.div>
      </div>
    );
  }

  const isInviteFlow = !!invite;

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
        className="relative w-full max-w-md rounded-[--radius-xl] border border-border-light bg-surface p-8 shadow-md"
      >
        {isInviteFlow ? (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
              Welcome, Teacher
            </h1>
            <div className="mt-2 flex items-center gap-2 rounded-[--radius-sm] bg-primary-bg px-3 py-2">
              <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
              </svg>
              <span className="text-sm font-semibold text-primary">
                {invite.school_name}
              </span>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
              Create your account
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Start mastering any subject
            </p>
          </>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Input
            label="Name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />

          <div>
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                if (isInviteFlow) return; // Email locked for invite flow
                setEmail(e.target.value);
                setEmailError("");
                if (error) clearError();
              }}
              onBlur={checkEmail}
              error={emailError}
              required
              autoComplete="email"
              disabled={isInviteFlow}
              className={isInviteFlow ? "opacity-60" : ""}
            />
            {checkingEmail && (
              <p className="mt-1 text-xs text-text-muted">Checking availability...</p>
            )}
          </div>

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

          {/* Grade picker — only for students */}
          {!isInviteFlow && (
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
          )}

          <Button
            type="submit"
            loading={loading}
            gradient
            className="w-full"
            disabled={!!emailError}
          >
            {isInviteFlow ? "Set Up Your Account" : "Create Account"}
          </Button>

          <p className="mt-4 text-center text-xs text-text-muted">
            By signing up, you agree to our{" "}
            <Link href="/terms" className="text-primary hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>.
          </p>
        </form>

        <div className="mt-6 border-t border-border-light pt-4 text-center">
          <p className="text-sm text-text-secondary">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-primary hover:text-primary-dark"
            >
              Sign In
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
