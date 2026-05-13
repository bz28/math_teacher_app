"use client";

import { Suspense, useState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import { auth, clearTokens, hasStoredTokens, type InviteData, type SectionInviteData } from "@/lib/api";
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
  const [joinCode, setJoinCode] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [teacherConfirmed, setTeacherConfirmed] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [checkingEmail, setCheckingEmail] = useState(false);
  const { register, loading, error, clearError, user } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  // Invite flow (teacher invite OR section invite — not both)
  const inviteToken = searchParams.get("invite");
  const sectionInviteToken = searchParams.get("section_invite");

  // Self-signup role. URL drives the initial value (`?role=teacher`
  // from the homepage "Start free" CTA) but the in-page toggle below
  // lets the user switch without changing URLs. Invite flows ignore
  // this — the invite is authoritative on role.
  const initialRole = searchParams.get("role") === "teacher" ? "teacher" : "student";
  const [role, setRole] = useState<"student" | "teacher">(initialRole);
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [sectionInvite, setSectionInvite] = useState<SectionInviteData | null>(null);
  const [inviteLoading, setInviteLoading] = useState(!!inviteToken || !!sectionInviteToken);
  const [inviteError, setInviteError] = useState("");

  // Clear stale tokens so loadUser() doesn't fire "Session expired" —
  // but only when no live session exists. A signed-in user navigating
  // here (e.g. clicking a stale header link) shouldn't be silently
  // logged out. Invite flows always clear so the invite's email
  // takes over from any cached identity.
  //
  // Check `hasStoredTokens()` (synchronous, reads localStorage) instead
  // of the auth store's `user`: on a fresh page load the AuthProvider's
  // `loadUser()` hasn't populated `user` yet (child effects run before
  // parent effects), so `useAuthStore.getState().user` is still null and
  // we'd wrongly clear tokens of a signed-in visitor.
  useEffect(() => {
    if (!hasStoredTokens() || inviteToken || sectionInviteToken) {
      clearTokens();
    }
  }, [inviteToken, sectionInviteToken]);

  // Redirect signed-in users away from /register so they can't
  // silently create a second account. The previous guard only
  // controlled clearTokens; nothing stopped them from filling the
  // form and submitting — auth.register would create a new user
  // and saveTokens() would overwrite the old session, orphaning
  // the first account. Invite flows are the exception: a signed-in
  // user accepting an invite is intentionally switching identities,
  // so let them through.
  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (inviteToken || sectionInviteToken) return;
    router.replace(user.role === "teacher" ? "/school/teacher" : "/home");
  }, [user, loading, inviteToken, sectionInviteToken, router]);

  // Validate invite token on mount (teacher or section — mutually exclusive)
  useEffect(() => {
    if (inviteToken) {
      setInviteLoading(true);
      auth
        .validateInvite(inviteToken)
        .then((data) => {
          setInvite(data);
          setEmail(data.email);
        })
        .catch(() => setInviteError("This invite link is invalid or has expired."))
        .finally(() => setInviteLoading(false));
    } else if (sectionInviteToken) {
      setInviteLoading(true);
      auth
        .validateSectionInvite(sectionInviteToken)
        .then((data) => {
          setSectionInvite(data);
          setEmail(data.email);
        })
        .catch(() => setInviteError("This invite link is invalid or has expired."))
        .finally(() => setInviteLoading(false));
    }
  }, [inviteToken, sectionInviteToken]);

  async function checkEmail() {
    if (!email || invite || sectionInvite) return;
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
    // Belt for the suspender redirect-useEffect: that effect fires
    // AFTER render, so a fast user could still submit the form in
    // the window before router.replace lands. Without this guard,
    // auth.register would create a brand-new account and
    // saveTokens() would overwrite the live session, orphaning the
    // original user. Invite flows are the intentional exception.
    if (user && !inviteToken && !sectionInviteToken) return;

    // Self-signup teacher (no invite). Role gets posted explicitly so
    // the backend creates a teacher account, and signup_school_name
    // travels along when provided. The "I am a teacher" affirmation
    // is form-only — the backend doesn't store the checkbox state.
    const isTeacherSelfSignup =
      role === "teacher" && !inviteToken && !sectionInviteToken;

    const trimmedCode = joinCode.trim().toUpperCase();
    const trimmedSchool = schoolName.trim();
    try {
      await register({
        email,
        password,
        name,
        grade_level: gradeLevel,
        ...(isTeacherSelfSignup ? { role: "teacher" as const } : {}),
        ...(isTeacherSelfSignup && trimmedSchool
          ? { signup_school_name: trimmedSchool }
          : {}),
        ...(inviteToken ? { invite_token: inviteToken } : {}),
        ...(sectionInviteToken ? { section_invite_token: sectionInviteToken } : {}),
        ...(trimmedCode ? { join_code: trimmedCode } : {}),
      });
      router.replace(
        invite || isTeacherSelfSignup
          ? "/school/teacher"
          : sectionInvite || trimmedCode
            ? "/school/student"
            : "/home",
      );
    } catch {
      const msg = useAuthStore.getState().error;
      if (msg) toast.error(msg);
    }
  }

  // Invite loading state
  if ((inviteToken || sectionInviteToken) && inviteLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-text-secondary">Verifying your invite...</p>
        </div>
      </div>
    );
  }

  // Signed-in non-invite landing: redirect-useEffect will fire on the
  // next tick. Render a spinner instead of the form so the user can't
  // (a) see a confusing prefilled UI flash for one render, or (b) race
  // the redirect by submitting before it lands. The handleSubmit guard
  // covers the same race defensively.
  if (user && !inviteToken && !sectionInviteToken) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Invite error state
  if ((inviteToken || sectionInviteToken) && inviteError) {
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
  const isSectionInviteFlow = !!sectionInvite;
  const lockEmail = isInviteFlow || isSectionInviteFlow;

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
        ) : isSectionInviteFlow ? (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
              Join {sectionInvite.course_name}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {sectionInvite.section_name}
              {sectionInvite.school_name ? ` · ${sectionInvite.school_name}` : ""}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
              Create your account
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {role === "teacher"
                ? "Start using Veradic in your classroom"
                : "Start mastering any subject"}
            </p>

            {/* Role toggle — only on self-signup. Invite flows hide
                this because the invite already determines role. */}
            <div
              role="group"
              aria-label="Choose account type"
              className="mt-5 flex rounded-[--radius-sm] border border-border-light bg-surface-alt p-1"
            >
              {(["student", "teacher"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={role === r}
                  onClick={() => {
                    setRole(r);
                    // Reset teacher-only fields when switching off
                    // teacher so a previously-checked affirmation or
                    // typed school name doesn't survive a toggle.
                    if (r === "student") {
                      setSchoolName("");
                      setTeacherConfirmed(false);
                    }
                  }}
                  className={`flex-1 rounded-[--radius-sm] px-3 py-2 text-sm font-semibold transition-colors ${
                    role === r
                      ? "bg-primary text-white shadow-sm"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {r === "student" ? "I'm a student" : "I'm a teacher"}
                </button>
              ))}
            </div>
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
                if (lockEmail) return; // Email locked for invite flows
                setEmail(e.target.value);
                setEmailError("");
                if (error) clearError();
              }}
              onBlur={checkEmail}
              error={emailError}
              required
              autoComplete="email"
              disabled={lockEmail}
              className={lockEmail ? "opacity-60" : ""}
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

          {/* Grade picker — shown for every self-signup path and for
              section-invite students. Hidden only for teacher-invite
              (where the welcome card lives in its own branch). The
              label flips for teachers so they read it as "what I
              teach" instead of "what grade I'm in". */}
          {!isInviteFlow && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold tracking-wide text-text-secondary">
                {role === "teacher" ? "Grade level you teach" : "Grade Level"}
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

          {/* Join code — students only; hidden for invite + teacher flows */}
          {!lockEmail && role === "student" && (
            <div>
              <Input
                label="Join code (optional)"
                placeholder="e.g. 3FH7KP"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={10}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="mt-1 text-xs text-text-muted">
                Got one from your teacher? We&apos;ll add you to the class.
              </p>
            </div>
          )}

          {/* Teacher-only fields — self-signup only (teacher invite
              has its own welcome card and doesn't show these). */}
          {!lockEmail && role === "teacher" && (
            <>
              <div>
                <Input
                  label="School (optional)"
                  placeholder="e.g. Lincoln High School"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  maxLength={200}
                />
                <p className="mt-1 text-xs text-text-muted">
                  Helps us understand who&apos;s joining. We won&apos;t contact your school.
                </p>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-[--radius-sm] border border-border-light bg-surface-alt px-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
                  checked={teacherConfirmed}
                  onChange={(e) => setTeacherConfirmed(e.target.checked)}
                  required
                />
                <span className="text-sm text-text-secondary">
                  I am a teacher and intend to use Veradic with my own students.
                </span>
              </label>
            </>
          )}

          <Button
            type="submit"
            loading={loading}
            gradient
            className="w-full"
            disabled={
              !!emailError ||
              (role === "teacher" && !lockEmail && !teacherConfirmed)
            }
          >
            {isInviteFlow
              ? "Set Up Your Account"
              : isSectionInviteFlow
                ? "Accept Invite"
                : "Create Account"}
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
