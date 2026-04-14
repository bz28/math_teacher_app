"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import { useEntitlementStore } from "@/stores/entitlements";
import { getManagementUrl } from "@/services/revenuecat";
import { Badge, Button, Modal, PasswordInput } from "@/components/ui";

export default function AccountPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const router = useRouter();

  const isPro = useEntitlementStore((s) => s.isPro);
  // School-linked students are entitlement-wise Pro (their school covers
  // access), but they have no personal subscription and nothing to
  // manage. Hide the Pro badge + Subscription card for them; show a
  // neutral "School" pill instead so the teacher/student context is
  // still visible at a glance.
  const isSchoolStudent = !!user?.school_id;
  // Preview accounts are shadow students teachers create via "View as
  // Student". They're not real users, have nothing to pay for, and
  // shouldn't see subscription/usage/upgrade UI at all. Covered
  // separately from isSchoolStudent because a preview without real
  // section enrollments can fall into the personal-free path and show
  // FREE + Upgrade to Pro otherwise.
  const isPreview = !!user?.is_preview;
  const loaded = useEntitlementStore((s) => s.loaded);
  const dailySessionsUsed = useEntitlementStore((s) => s.dailySessionsUsed);
  const dailySessionsLimit = useEntitlementStore((s) => s.dailySessionsLimit);
  const dailyScansUsed = useEntitlementStore((s) => s.dailyScansUsed);
  const dailyScansLimit = useEntitlementStore((s) => s.dailyScansLimit);
  const dailyChatsUsed = useEntitlementStore((s) => s.dailyChatsUsed);
  const dailyChatsLimit = useEntitlementStore((s) => s.dailyChatsLimit);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);

  const [portalLoading, setPortalLoading] = useState(false);

  // Delete account state
  const [showConfirm, setShowConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loaded) fetchEntitlements();
  }, [loaded, fetchEntitlements]);

  async function openPortal() {
    if (!user) return;
    setPortalLoading(true);
    try {
      const url = await getManagementUrl(user.id);
      if (url) window.location.assign(url);
    } catch {
      // Silently fail
    } finally {
      setPortalLoading(false);
    }
  }

  function handleConfirm() {
    setShowConfirm(false);
    setPassword("");
    setDeleteError(null);
    setShowPasswordModal(true);
  }

  async function handleDelete() {
    if (!password.trim()) {
      setDeleteError("Please enter your password");
      passwordRef.current?.focus();
      return;
    }
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await deleteAccount(password);
      setShowPasswordModal(false);
      router.push("/login");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setDeleteError(message);
      passwordRef.current?.focus();
    } finally {
      setDeleteLoading(false);
    }
  }

  if (!user) return null;

  const initial = user.name?.[0]?.toUpperCase() ?? "?";

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      {/* Profile header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center"
      >
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-light shadow-md">
          <span className="text-3xl font-extrabold text-white">{initial}</span>
        </div>
        <h1 className="mt-4 text-xl font-bold text-text-primary">{user.name}</h1>
        <p className="mt-1 text-sm text-text-muted">{user.email}</p>
        <div className="mt-3">
          {isPreview ? (
            <Badge variant="muted">Preview</Badge>
          ) : isSchoolStudent ? (
            <Badge variant="muted">School</Badge>
          ) : (
            <Badge variant={isPro ? "success" : "muted"}>
              {isPro && <StarIcon />}
              {isPro ? "PRO" : "FREE"}
            </Badge>
          )}
        </div>
      </motion.div>

      {/* Subscription card — hidden for school students and previews
          (no personal subscription to manage). */}
      {isPro && !isSchoolStudent && !isPreview && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mt-8 rounded-[--radius-xl] border border-border-light bg-surface p-5"
        >
          <h2 className="text-sm font-bold text-text-primary">Subscription</h2>
          <div className="mt-3 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">Status</span>
              <span className="font-medium capitalize text-text-primary">
                {user.subscription_status}
              </span>
            </div>
            {user.subscription_expires_at && (
              <div className="flex justify-between">
                <span className="text-text-secondary">Renews</span>
                <span className="font-medium text-text-primary">
                  {new Date(user.subscription_expires_at).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={openPortal}
            disabled={portalLoading}
            className="mt-4 w-full rounded-[--radius-pill] border border-border-light py-2.5 text-sm font-bold text-text-primary transition-colors hover:bg-primary-bg disabled:opacity-50"
          >
            {portalLoading ? "Loading..." : "Manage Subscription"}
          </button>
        </motion.div>
      )}

      {/* Usage card — free users (preview accounts skip — quotas don't
          apply in a teacher's view-as-student session). */}
      {!isPro && !isPreview && loaded && dailySessionsLimit < Infinity && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mt-8 rounded-[--radius-xl] border border-border-light bg-surface p-5"
        >
          <h2 className="text-sm font-bold text-text-primary">Daily Usage</h2>
          <div className="mt-4 space-y-4">
            <UsageBar label="Problems" used={dailySessionsUsed} limit={dailySessionsLimit} icon={<BookIcon />} />
            <UsageBar label="Scans" used={dailyScansUsed} limit={dailyScansLimit} icon={<CameraIcon />} />
            <UsageBar label="Chats" used={dailyChatsUsed} limit={dailyChatsLimit} icon={<ChatIcon />} />
          </div>
        </motion.div>
      )}

      {/* Upgrade button — free users (preview accounts skip — teacher
          already has Pro; the preview doesn't need to purchase anything). */}
      {!isPro && !isPreview && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mt-5"
        >
          <Link
            href="/pricing"
            className="flex items-center justify-center gap-2 rounded-[--radius-xl] bg-gradient-to-r from-primary to-primary-light py-3.5 text-sm font-bold text-white shadow-sm transition-shadow hover:shadow-md"
          >
            <StarIcon />
            Upgrade to Pro
          </Link>
        </motion.div>
      )}

      {/* Sign out */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="mt-10 border-t border-border-light pt-6"
      >
        <button
          onClick={() => { logout(); router.push("/login"); }}
          className="flex w-full items-center justify-center gap-2 rounded-[--radius-md] py-2.5 text-sm font-semibold text-error transition-colors hover:bg-error-light"
        >
          <LogoutIcon />
          Sign Out
        </button>
      </motion.div>

      {/* Danger zone */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="mt-4 flex justify-center pb-8"
      >
        <button
          onClick={() => setShowConfirm(true)}
          className="text-xs text-text-muted transition-colors hover:text-error"
        >
          Delete Account
        </button>
      </motion.div>

      {/* Step 1: Confirmation modal */}
      <Modal open={showConfirm} onClose={() => setShowConfirm(false)}>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error-light">
            <TrashIcon className="h-6 w-6 text-error" />
          </div>
          <h2 className="text-lg font-bold text-text-primary">Delete Your Account?</h2>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">
            This will permanently delete your account and all your data. This action cannot be undone.
          </p>
          {isPro && (
            <p className="mt-3 rounded-[--radius-md] bg-warning-bg p-3 text-left text-sm text-text-secondary">
              You have an active subscription. Please cancel it in your subscription settings first, or you&apos;ll continue to be charged.
            </p>
          )}
          <div className="mt-6 flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setShowConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleConfirm}
            >
              Continue
            </Button>
          </div>
        </div>
      </Modal>

      {/* Step 2: Password verification modal */}
      <Modal
        open={showPasswordModal}
        onClose={() => !deleteLoading && setShowPasswordModal(false)}
        dismissible={!deleteLoading}
      >
        <div>
          <h2 className="text-lg font-bold text-text-primary">Verify Your Identity</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Enter your password to confirm account deletion.
          </p>
          <form
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              handleDelete();
            }}
          >
            <PasswordInput
              ref={passwordRef}
              label="Password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setDeleteError(null); }}
              error={deleteError ?? undefined}
              disabled={deleteLoading}
              autoFocus
              placeholder="Enter your password"
            />
            <div className="mt-6 flex gap-3">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => setShowPasswordModal(false)}
                disabled={deleteLoading}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                type="submit"
                loading={deleteLoading}
              >
                Delete My Account
              </Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}

// ── Usage bar ──

function UsageBar({ label, used, limit, icon }: { label: string; used: number; limit: number; icon: React.ReactNode }) {
  const pct = limit > 0 ? Math.min(used / limit, 1) : 0;
  const barColor = pct >= 1 ? "bg-error" : pct >= 0.8 ? "bg-warning-dark" : "bg-primary";

  return (
    <div className="flex items-center gap-3">
      <div className="flex w-24 items-center gap-2 text-text-secondary">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className="flex flex-1 items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-light">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${pct * 100}%` }}
          />
        </div>
        <span className={`w-10 text-right text-xs font-medium ${pct >= 1 ? "text-error" : "text-text-muted"}`}>
          {used}/{limit}
        </span>
      </div>
    </div>
  );
}

// ── Icons ──

function StarIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-4 w-4"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
