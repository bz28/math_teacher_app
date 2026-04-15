"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { auth, hasStoredTokens, type SectionInviteData } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui";

export default function SectionInvitePage() {
  return (
    <Suspense>
      <SectionInviteContent />
    </Suspense>
  );
}

type View =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "needs_signup"; invite: SectionInviteData }
  | { kind: "needs_signin"; invite: SectionInviteData }
  | { kind: "wrong_account"; invite: SectionInviteData; signedInEmail: string }
  | { kind: "claiming"; invite: SectionInviteData }
  | { kind: "claimed"; invite: SectionInviteData };

function SectionInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { user, loading: authLoading, loadUser, logout } = useAuthStore();
  const [view, setView] = useState<View>(() =>
    token ? { kind: "loading" } : { kind: "invalid", message: "Missing invite token." },
  );

  useEffect(() => {
    if (!hasStoredTokens()) return;
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (!token) return;
    if (authLoading) return;
    let cancelled = false;
    auth
      .validateSectionInvite(token)
      .then(async (invite) => {
        if (cancelled) return;
        if (!user) {
          const stillHasTokens = hasStoredTokens();
          setView({
            kind: stillHasTokens ? "needs_signin" : "needs_signup",
            invite,
          });
          return;
        }
        if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
          setView({ kind: "wrong_account", invite, signedInEmail: user.email });
          return;
        }
        setView({ kind: "claiming", invite });
        try {
          await auth.claimSectionInvite(token);
          if (!cancelled) setView({ kind: "claimed", invite });
        } catch (e) {
          if (!cancelled) {
            setView({
              kind: "invalid",
              message: e instanceof Error ? e.message : "Could not claim invite.",
            });
          }
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setView({
            kind: "invalid",
            message: e instanceof Error ? e.message : "Invite link is invalid or has expired.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, authLoading, user]);

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-[--radius-xl] border border-border-light bg-surface p-8 shadow-md"
      >
        {view.kind === "loading" && (
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-text-secondary">Verifying your invite…</p>
          </div>
        )}

        {view.kind === "invalid" && (
          <div className="text-center">
            <h1 className="text-xl font-bold text-text-primary">Invite Not Valid</h1>
            <p className="mt-2 text-sm text-text-secondary">{view.message}</p>
            <p className="mt-4 text-sm text-text-secondary">
              Ask your teacher to send a new invite.
            </p>
            <Link href="/" className="mt-6 inline-block text-sm font-semibold text-primary hover:text-primary-dark">
              Back to Home
            </Link>
          </div>
        )}

        {view.kind === "needs_signup" && token && (
          <>
            <InviteHeader invite={view.invite} />
            <p className="mt-4 text-sm text-text-secondary">
              Create an account with <strong>{view.invite.email}</strong> to join.
            </p>
            <Button
              gradient
              className="mt-6 w-full"
              onClick={() => router.push(`/register?section_invite=${encodeURIComponent(token)}`)}
            >
              Create account
            </Button>
            <p className="mt-3 text-center text-xs text-text-muted">
              Already have an account?{" "}
              <Link
                href={`/login?redirect=${encodeURIComponent(`/invite/section?token=${token}`)}`}
                className="font-semibold text-primary hover:text-primary-dark"
              >
                Sign in
              </Link>
            </p>
          </>
        )}

        {view.kind === "needs_signin" && token && (
          <>
            <InviteHeader invite={view.invite} />
            <p className="mt-4 text-sm text-text-secondary">
              Sign in as <strong>{view.invite.email}</strong> to accept this invite.
            </p>
            <Button
              gradient
              className="mt-6 w-full"
              onClick={() =>
                router.push(`/login?redirect=${encodeURIComponent(`/invite/section?token=${token}`)}`)
              }
            >
              Sign in
            </Button>
          </>
        )}

        {view.kind === "wrong_account" && (
          <>
            <InviteHeader invite={view.invite} />
            <p className="mt-4 text-sm text-text-secondary">
              This invite was sent to <strong>{view.invite.email}</strong>, but you&rsquo;re signed
              in as <strong>{view.signedInEmail}</strong>. Sign out and sign back in with the
              invited email to continue.
            </p>
            <Button
              gradient
              className="mt-6 w-full"
              onClick={() => {
                logout();
                if (token) {
                  router.replace(`/invite/section?token=${token}`);
                }
              }}
            >
              Sign out
            </Button>
          </>
        )}

        {view.kind === "claiming" && (
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-text-secondary">Joining {view.invite.section_name}…</p>
          </div>
        )}

        {view.kind === "claimed" && (
          <>
            <InviteHeader invite={view.invite} />
            <p className="mt-4 text-sm text-text-secondary">
              You&rsquo;re in! Head to your dashboard to get started.
            </p>
            <Button
              gradient
              className="mt-6 w-full"
              onClick={() => router.replace("/school/student")}
            >
              Go to dashboard
            </Button>
          </>
        )}
      </motion.div>
    </div>
  );
}

function InviteHeader({ invite }: { invite: SectionInviteData }) {
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
        {invite.course_name}
      </h1>
      <p className="mt-1 text-sm text-text-secondary">
        {invite.section_name}
        {invite.school_name ? ` · ${invite.school_name}` : ""}
      </p>
    </>
  );
}
