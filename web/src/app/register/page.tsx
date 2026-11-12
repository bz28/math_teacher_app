"use client";

import { Suspense, useState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import { auth, clearTokens, hasStoredTokens, type InviteData, type SectionInviteData } from "@/lib/api";
import { useToast } from "@/components/ui";
import { ButtonLink } from "@/components/site/button-link";
import { AuthShell, AUTH_CARD, AUTH_H1 } from "@/components/site/auth-shell";
import { SiteInput, SitePasswordInput, SiteSubmit, Spinner } from "@/components/site/form";

// Student grade options. Signup is invite-only: every student arrives with
// a class join code or a class invite (the backend refuses anything else,
// see RegisterRequest.enforce_invite_only_signup). The 8th-grade floor is
// left over from the old under-13 self-signup gate; younger students can
// join with a code, so lowering it is an open follow-up.
const GRADE_OPTIONS = [
  { label: "8th grade", value: 8 },
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
  // Which door the visitor says they came for. Only shown without an
  // invite link: an invite already settles the question. Picking
  // "teacher" here leads to the book-a-demo page, not a form.
  const [audience, setAudience] = useState<"student" | "teacher">("student");
  const [emailError, setEmailError] = useState("");
  const [checkingEmail, setCheckingEmail] = useState(false);
  const { register, loading, error, clearError, user } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  // Invite flow (teacher invite OR section invite — not both)
  const inviteToken = searchParams.get("invite");
  const sectionInviteToken = searchParams.get("section_invite");

  // The form itself only ever creates students. Veradic is sold to
  // schools, so a teacher belongs on the demo path (or their school's
  // invite link), not here — the picker below routes them there rather
  // than letting them sign up into the wrong kind of account.
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
    //
    // Also covers the loadUser-in-flight race: on a fresh mount with
    // stored tokens, `user` is null until AuthProvider's loadUser
    // resolves. Checking `hasStoredTokens()` synchronously catches a
    // submit during that window.
    if ((user || hasStoredTokens()) && !inviteToken && !sectionInviteToken) return;

    const trimmedCode = joinCode.trim().toUpperCase();
    // `required` on the input accepts spaces, so check the trimmed code.
    if (!lockEmail && !trimmedCode) {
      toast.error("Enter the class join code from your teacher.");
      return;
    }
    try {
      await register({
        email,
        password,
        name,
        grade_level: gradeLevel,
        ...(inviteToken ? { invite_token: inviteToken } : {}),
        ...(sectionInviteToken ? { section_invite_token: sectionInviteToken } : {}),
        ...(trimmedCode ? { join_code: trimmedCode } : {}),
      });
      router.replace(invite ? "/school/teacher" : "/school/student");
    } catch {
      const msg = useAuthStore.getState().error;
      if (msg) toast.error(msg);
    }
  }

  // Invite loading state
  if ((inviteToken || sectionInviteToken) && inviteLoading) {
    return (
      <AuthShell>
        <div className="py-16 text-center" role="status">
          <Spinner className="h-8 w-8 border-veradic" />
          <p className="m-0 mt-4 text-[15px] text-ink-soft">Verifying your invite...</p>
        </div>
      </AuthShell>
    );
  }

  // Signed-in non-invite landing: redirect-useEffect will fire on the
  // next tick. Render a spinner instead of the form so the user can't
  // (a) see a confusing prefilled UI flash for one render, or (b) race
  // the redirect by submitting before it lands. Catches both the
  // already-loaded user case AND the loadUser-in-flight case (tokens
  // present, user still null mid-request) — both are "this person is
  // signed in, don't show them a signup form."
  if ((user || hasStoredTokens()) && !inviteToken && !sectionInviteToken) {
    return (
      <AuthShell>
        <div className="py-16" role="status" aria-label="Signing you in">
          <Spinner className="h-8 w-8 border-veradic" />
        </div>
      </AuthShell>
    );
  }

  // Invite error state
  if ((inviteToken || sectionInviteToken) && inviteError) {
    return (
      <AuthShell>
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className={AUTH_CARD}
        >
          <h1 className={AUTH_H1}>Invite not valid.</h1>
          <p className="m-0 mt-3 text-base leading-[1.5] text-ink-soft">{inviteError}</p>
          <p className="m-0 mt-3 text-base leading-[1.5] text-ink-soft">
            Contact your school administrator to request a new invite.
          </p>
          <Link href="/" className="mt-6 inline-block text-[15px] font-bold text-veradic underline underline-offset-4 hover:text-veradic-dark">
            Back to home
          </Link>
        </motion.div>
      </AuthShell>
    );
  }

  const isInviteFlow = !!invite;
  const isSectionInviteFlow = !!sectionInvite;
  const lockEmail = isInviteFlow || isSectionInviteFlow;

  const showJoinForm = !(audience === "teacher" && !lockEmail);

  return (
    <AuthShell switchPrompt="Already have an account?" switchLabel="Sign in" switchHref="/login">
      {/* Quiet entrance: opacity + 4px rise, no spring. */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className={AUTH_CARD}
      >
        {/* Which door: shown without an invite link (an invite already
            settles it). A segmented switch on the card, as a radio group:
            one tab stop, arrows move between the two. */}
        {!lockEmail && (
          <div role="radiogroup" aria-label="I'm a…" className="mb-6 flex rounded-[6px] bg-[#F0EEE6] p-1">
            {(["student", "teacher"] as const).map((role) => (
              <button
                key={role}
                type="button"
                role="radio"
                aria-checked={audience === role}
                // A radiogroup is one tab stop, and arrows move within it.
                // Without this the role announces a choice the keyboard
                // can't actually make.
                tabIndex={audience === role ? 0 : -1}
                onKeyDown={(e) => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                  e.preventDefault();
                  const next = audience === "student" ? "teacher" : "student";
                  setAudience(next);
                  e.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>(`[data-audience="${next}"]`)
                    ?.focus();
                }}
                data-audience={role}
                onClick={() => setAudience(role)}
                className={`flex-1 rounded-[4px] px-2 py-2.5 text-[15px] transition-colors ${
                  audience === role
                    ? "bg-white font-extrabold text-ink shadow-[0_1px_2px_rgba(29,38,51,0.18)]"
                    : "font-bold text-ink-soft hover:text-ink"
                }`}
              >
                I&apos;m a {role}
              </button>
            ))}
          </div>
        )}

        {isInviteFlow ? (
          <>
            <h1 className={AUTH_H1}>Welcome, Teacher</h1>
            <p className="m-0 mt-3 inline-block rounded-[6px] bg-[#E4F0EA] px-3 py-1.5 text-[15px] font-bold text-veradic">
              {invite.school_name}
            </p>
          </>
        ) : isSectionInviteFlow ? (
          <>
            <h1 className={AUTH_H1}>Join {sectionInvite.course_name}</h1>
            <p className="m-0 mt-2 text-base text-ink-soft">
              {sectionInvite.section_name}
              {sectionInvite.school_name ? ` · ${sectionInvite.school_name}` : ""}
            </p>
          </>
        ) : (
          <h1 className={AUTH_H1}>
            {audience === "teacher" ? "Teacher accounts come from your school." : "Join your class"}
          </h1>
        )}

        {!showJoinForm ? (
          <div>
            <p className="m-0 mt-3 text-base leading-[1.55] text-ink-soft">
              Use the link in your invite email. New to Veradic? We&apos;ll set
              up your school on a 20-minute call.
            </p>
            <ButtonLink href="/demo" variant="ink" className="mt-5">
              Book a demo
            </ButtonLink>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {/* Join code first, set large: it's the one thing a student
              brings. Required without an invite link (Veradic is
              invite-only); hidden for invite flows. */}
          {!lockEmail && (
            <SiteInput
              label="Class join code"
              placeholder="3FH7KP"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              required
              maxLength={10}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              large
              hint="Your teacher gives you this code: six letters and numbers. Don't have one? Ask your teacher."
            />
          )}

          <SiteInput
            label="Name"
            placeholder="First and last name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />

          <div>
            <SiteInput
              label="Email"
              type="email"
              placeholder="you@school.org"
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
            />
            {checkingEmail && (
              <p className="m-0 mt-1.5 text-sm text-ink-soft" role="status">Checking availability...</p>
            )}
          </div>

          <SitePasswordInput
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

          {/* Grade picker — shown for join-code and section-invite
              students. Hidden only for teacher-invite
              (where the welcome card lives in its own branch). */}
          {!isInviteFlow && (
            <div role="group" aria-labelledby="grade-label">
              <p id="grade-label" className="m-0 text-[15px] font-bold text-ink">
                Grade level
              </p>
              <div className="mt-2 flex gap-2">
                {GRADE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={gradeLevel === opt.value}
                    onClick={() => setGradeLevel(opt.value)}
                    className={`flex-1 rounded-[6px] border-[1.5px] px-1 py-2.5 text-sm font-bold transition-colors ${
                      gradeLevel === opt.value
                        ? "border-veradic bg-[#E4F0EA] text-veradic"
                        : "border-[#8A93A0] bg-[#FBFAF6] text-ink-soft hover:border-ink hover:text-ink"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="pt-1">
            <SiteSubmit loading={loading} disabled={!!emailError}>
              {isInviteFlow
                ? "Set up your account"
                : isSectionInviteFlow
                  ? "Accept invite"
                  : "Create account"}
            </SiteSubmit>
          </div>

          <p className="m-0 text-center text-sm leading-[1.5] text-ink-soft">
            By signing up, you agree to our{" "}
            <Link href="/terms" className="font-semibold text-veradic underline underline-offset-2 hover:text-veradic-dark">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-semibold text-veradic underline underline-offset-2 hover:text-veradic-dark">
              Privacy Policy
            </Link>.
          </p>
        </form>
        )}
      </motion.div>
    </AuthShell>
  );
}
