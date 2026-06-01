"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import { useEntitlementStore } from "@/stores/entitlements";
import { getManagementUrl } from "@/services/revenuecat";
import { auth as authApi, billing, ApiError } from "@/lib/api";
import { Badge, Button, Modal, PasswordInput } from "@/components/ui";

export default function AccountPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const loadUser = useAuthStore((s) => s.loadUser);
  const router = useRouter();

  const isPro = useEntitlementStore((s) => s.isPro);
  // School-linked accounts (real students AND school teachers — the
  // school pays, no personal sub to manage) have no personal sub, no
  // per-day quota, and nothing to upgrade. Gate every sub-oriented
  // UI on this rather than on isPro, because a teacher preview whose
  // teacher has no section enrollments still reads is_pro=false from
  // /entitlements yet should hide all upgrade affordances.
  const isSchoolAffiliated = !!user?.school_id;
  const isTeacher = user?.role === "teacher";
  // Stripe-paying teachers must route to the Stripe Customer Portal,
  // not RevenueCat — RevenueCat doesn't know about them.
  const useStripePortal = user?.subscription_provider === "stripe";
  const loaded = useEntitlementStore((s) => s.loaded);
  const dailySessionsUsed = useEntitlementStore((s) => s.dailySessionsUsed);
  const dailySessionsLimit = useEntitlementStore((s) => s.dailySessionsLimit);
  const dailyScansUsed = useEntitlementStore((s) => s.dailyScansUsed);
  const dailyScansLimit = useEntitlementStore((s) => s.dailyScansLimit);
  const dailyChatsUsed = useEntitlementStore((s) => s.dailyChatsUsed);
  const dailyChatsLimit = useEntitlementStore((s) => s.dailyChatsLimit);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);

  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  // Stripe portal 404s without a stripe_customer_id (admin-set is_pro=true
  // user, wiped customer row). Disable up-front rather than silent-fail
  // mid-click — mirrors ActiveTeacherSubscription on /pricing.
  const canManageStripe = !useStripePortal || user?.has_stripe_customer === true;

  // Delete account state
  const [showConfirm, setShowConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // MFA state. Surface only to teachers/admins — students aren't a
  // high-value target for credential theft and don't need the extra
  // friction. Districts can enforce it via their own policy for staff.
  const showMfaSection = user?.role === "teacher" || user?.role === "admin";
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [showMfaDisableModal, setShowMfaDisableModal] = useState(false);
  const [mfaDisablePassword, setMfaDisablePassword] = useState("");

  // Data export — triggers a JSON download of the user's personal data.
  // Available to all roles; primarily satisfies PA Personnel Files Act
  // self-service access for teachers but it's the user's data either way.
  const [exportLoading, setExportLoading] = useState(false);

  async function handleDownloadData() {
    setExportLoading(true);
    try {
      const data = await authApi.myData();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `veradic-data-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Use the existing toast if there's a global one wired here.
      // Falling back to a quiet console log so a transient failure
      // doesn't crash the page — user can retry.
      console.error("Failed to download data export");
    } finally {
      setExportLoading(false);
    }
  }

  async function handleEnableMfa() {
    setMfaLoading(true);
    setMfaError(null);
    try {
      await authApi.mfaEnable();
      await loadUser();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Couldn't enable MFA. Please try again.";
      setMfaError(msg);
    } finally {
      setMfaLoading(false);
    }
  }

  async function handleConfirmDisableMfa() {
    if (!mfaDisablePassword.trim()) {
      setMfaError("Please enter your password to disable MFA.");
      return;
    }
    setMfaLoading(true);
    setMfaError(null);
    try {
      await authApi.mfaDisable(mfaDisablePassword);
      await loadUser();
      setShowMfaDisableModal(false);
      setMfaDisablePassword("");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Couldn't disable MFA. Please try again.";
      setMfaError(msg);
    } finally {
      setMfaLoading(false);
    }
  }

  useEffect(() => {
    if (!loaded) fetchEntitlements();
  }, [loaded, fetchEntitlements]);

  async function openPortal() {
    if (!user) return;
    setPortalLoading(true);
    setPortalError(null);
    try {
      if (useStripePortal) {
        const { portal_url } = await billing.teacherPortal();
        window.location.assign(portal_url);
      } else {
        const url = await getManagementUrl(user.id);
        if (!url) {
          setPortalError("Couldn't open the management portal. Please try again later.");
          return;
        }
        window.location.assign(url);
      }
    } catch {
      setPortalError("Couldn't open the management portal. Please try again later.");
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
          {isSchoolAffiliated ? (
            <Badge variant="muted">School</Badge>
          ) : (
            <Badge variant={isPro ? "success" : "muted"}>
              {isPro && <StarIcon />}
              {isPro ? "PRO" : "FREE"}
            </Badge>
          )}
        </div>
      </motion.div>

      {/* Subscription card — hidden for school students (no personal
          subscription to manage). */}
      {isPro && !isSchoolAffiliated && (
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
          {portalError && (
            <p role="alert" className="mt-4 text-sm text-error">{portalError}</p>
          )}
          <button
            onClick={openPortal}
            disabled={portalLoading || !canManageStripe}
            title={canManageStripe ? undefined : "Subscription management is unavailable for this account. Contact support if you need to make a change."}
            className="mt-4 w-full rounded-[--radius-pill] border border-border-light py-2.5 text-sm font-bold text-text-primary transition-colors hover:bg-primary-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {portalLoading ? "Loading..." : "Manage Subscription"}
          </button>
        </motion.div>
      )}

      {/* Usage card — free students only. Teachers have a totally
          different cap shape (10 problem generations/day, surfaced by
          the sidebar meter pill), and these student counters
          (Problems/Scans/Chats) don't apply to them at all. */}
      {!isTeacher && !isPro && !isSchoolAffiliated && loaded && dailySessionsLimit < Infinity && (
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

      {/* Upgrade button — personal free users only. School-linked
          users (including previews) have nothing to upgrade. */}
      {!isPro && !isSchoolAffiliated && (
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

      {/* Two-factor authentication — teachers and admins only. Email-
          based; uses the same address on file. Required by some
          district procurement processes; opt-in everywhere else. */}
      {showMfaSection && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="mt-8 rounded-[--radius-xl] border border-border-light bg-surface p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-text-primary">Two-factor authentication</h2>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                {user.mfa_enabled
                  ? `Enabled. We'll email a 6-digit code to ${user.email} each time you sign in.`
                  : "Add a second sign-in step using a code emailed to your address. Recommended for school accounts."}
              </p>
            </div>
            {user.mfa_enabled ? (
              <Badge variant="success">On</Badge>
            ) : (
              <Badge variant="muted">Off</Badge>
            )}
          </div>
          {mfaError && !showMfaDisableModal && (
            <p role="alert" className="mt-3 text-sm text-error">{mfaError}</p>
          )}
          {user.mfa_enabled ? (
            <button
              onClick={() => {
                setMfaError(null);
                setMfaDisablePassword("");
                setShowMfaDisableModal(true);
              }}
              className="mt-4 w-full rounded-[--radius-pill] border border-border-light py-2.5 text-sm font-bold text-text-primary transition-colors hover:bg-primary-bg"
            >
              Disable two-factor
            </button>
          ) : (
            <button
              onClick={handleEnableMfa}
              disabled={mfaLoading}
              className="mt-4 w-full rounded-[--radius-pill] border border-border-light py-2.5 text-sm font-bold text-text-primary transition-colors hover:bg-primary-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mfaLoading ? "Enabling..." : "Enable two-factor"}
            </button>
          )}
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

      {/* MFA disable modal — re-verify password to prevent a hijacked
          live session from weakening the account. */}
      <Modal open={showMfaDisableModal} onClose={() => { setShowMfaDisableModal(false); setMfaError(null); }}>
        <div>
          <h2 className="text-lg font-bold text-text-primary">Disable two-factor?</h2>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">
            Enter your password to confirm. Your account will no longer require an email code to sign in.
          </p>
          <div className="mt-4">
            <PasswordInput
              label="Password"
              placeholder="Your password"
              value={mfaDisablePassword}
              onChange={(e) => setMfaDisablePassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>
          {mfaError && (
            <p role="alert" className="mt-3 text-sm text-error">{mfaError}</p>
          )}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => { setShowMfaDisableModal(false); setMfaError(null); }}
              disabled={mfaLoading}
              className="flex-1 rounded-[--radius-sm] border border-border px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:border-text-primary hover:text-text-primary disabled:opacity-50"
            >
              Cancel
            </button>
            <Button
              onClick={handleConfirmDisableMfa}
              loading={mfaLoading}
              variant="danger"
              className="flex-1"
            >
              Disable
            </Button>
          </div>
        </div>
      </Modal>

      {/* Data and account zone — bottom-of-page actions kept quiet
          and text-only so they don't compete with the primary cards
          above. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="mt-4 flex flex-col items-center gap-3 pb-8"
      >
        <button
          onClick={handleDownloadData}
          disabled={exportLoading}
          className="text-xs text-text-muted transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exportLoading ? "Preparing your data..." : "Download my data"}
        </button>
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
