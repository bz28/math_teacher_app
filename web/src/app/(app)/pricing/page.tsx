"use client";

import { useState } from "react";
import { useAuthStore } from "@/stores/auth";
import { useEntitlementStore } from "@/stores/entitlements";
import { promo as promoApi } from "@/lib/api";
import { purchasePlan, getManagementUrl, type PlanType } from "@/services/revenuecat";
import { CheckIcon } from "@/components/ui/icons";

const plans: { id: PlanType; name: string; price: string; period: string; perMonth: string | null; badge: string | null; trial: string; cta: string }[] = [
  {
    id: "weekly",
    name: "Weekly",
    price: "$2.99",
    period: "/week",
    perMonth: null,
    badge: null,
    trial: "3-day free trial",
    cta: "Start Free Trial",
  },
  {
    id: "annual",
    name: "Yearly",
    price: "$69.99",
    period: "/year",
    perMonth: "$1.35/week",
    badge: "Best Value — Save 55%",
    trial: "7-day free trial",
    cta: "Start Free Trial",
  },
];

const proFeatures = [
  "Unlimited sessions",
  "Mock exams with timer",
  "Work diagnosis (AI grading)",
  "Unlimited image scanning",
  "Full session history",
];

export default function PricingPage() {
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (user?.is_pro) {
    return <ActiveSubscription />;
  }

  async function handlePurchase(plan: (typeof plans)[number]) {
    if (!user) return;
    setLoading(plan.id);
    setError(null);
    try {
      const purchased = await purchasePlan(plan.id, user.id, user.email);
      if (purchased) {
        await useEntitlementStore.getState().fetchEntitlements();
        await useAuthStore.getState().loadUser();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-extrabold text-text-primary">Upgrade to Pro</h1>
      <p className="mt-2 text-text-secondary">
        Unlock unlimited sessions, mock exams, and more.
      </p>

      {error && (
        <div className="mt-4 rounded-[--radius-md] bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`relative rounded-[--radius-xl] border p-6 ${
              plan.badge
                ? "border-primary shadow-lg shadow-primary/5"
                : "border-border-light"
            } bg-surface`}
          >
            {plan.badge && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-bold text-white">
                {plan.badge}
              </span>
            )}
            <h3 className="text-lg font-bold text-text-primary">{plan.name}</h3>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold text-text-primary">{plan.price}</span>
              <span className="text-sm text-text-secondary">{plan.period}</span>
            </div>
            {plan.perMonth && (
              <p className="mt-1 text-sm font-medium text-success">{plan.perMonth} — Save 55%</p>
            )}
            {plan.trial && (
              <p className="mt-2 inline-block rounded-[--radius-sm] bg-primary-bg px-3 py-1 text-xs font-semibold text-primary">
                {plan.trial}
              </p>
            )}
            <ul className="mt-6 space-y-3">
              {proFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                  <CheckIcon className="inline h-4 w-4 shrink-0 text-success" /> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => handlePurchase(plan)}
              disabled={loading !== null}
              className={`mt-6 w-full rounded-[--radius-pill] py-3 text-sm font-bold transition-colors disabled:opacity-50 ${
                plan.badge
                  ? "bg-primary text-white hover:bg-primary-dark"
                  : "border border-primary text-primary hover:bg-primary-bg"
              }`}
            >
              {loading === plan.id ? "Loading..." : plan.cta}
            </button>
          </div>
        ))}
      </div>

      <PromoCodeSection />
    </div>
  );
}

function PromoCodeSection() {
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);
  const loadUser = useAuthStore((s) => s.loadUser);

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setRedeeming(true);
    setPromoError(null);
    try {
      const result = await promoApi.redeem(code.trim());
      setSuccess(result.message);
      await fetchEntitlements();
      await loadUser();
      setCode("");
    } catch (err) {
      setPromoError((err as Error).message ?? "Could not redeem this code.");
    } finally {
      setRedeeming(false);
    }
  }

  if (success) {
    return (
      <div className="mt-8 rounded-[--radius-xl] border border-success/30 bg-success/5 p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
          <CheckIcon className="inline h-6 w-6 shrink-0 text-success" />
        </div>
        <p className="text-lg font-bold text-text-primary">{success}</p>
        <p className="mt-1 text-sm text-text-secondary">Enjoy your Pro features!</p>
      </div>
    );
  }

  return (
    <div className="mt-8 text-center">
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="text-sm font-semibold text-text-secondary hover:text-primary transition-colors"
        >
          Have a promo code?
        </button>
      ) : (
        <div className="mx-auto max-w-sm">
          <form onSubmit={handleRedeem} className="flex gap-3">
            <input
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setPromoError(null); }}
              placeholder="Enter promo code"
              autoFocus
              className="flex-1 rounded-[--radius-md] border border-border-light bg-surface px-4 py-2.5 text-sm font-medium text-text-primary placeholder:text-text-muted outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
            <button
              type="submit"
              disabled={redeeming || !code.trim()}
              className="rounded-[--radius-md] bg-primary px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {redeeming ? "Redeeming..." : "Redeem"}
            </button>
          </form>
          {promoError && (
            <p className="mt-2 text-sm text-error">{promoError}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ActiveSubscription() {
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(false);

  async function openPortal() {
    if (!user) return;
    setLoading(true);
    try {
      const url = await getManagementUrl(user.id);
      if (url) {
        window.location.assign(url);
      }
    } catch {
      // Silently fail — button re-enables
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10 text-center">
      <div className="rounded-[--radius-xl] border border-success/30 bg-success/5 p-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <CheckIcon className="inline h-8 w-8 shrink-0 text-success" />
        </div>
        <h1 className="text-2xl font-extrabold text-text-primary">Pro Plan Active</h1>
        <p className="mt-2 text-text-secondary">
          Status: <span className="font-medium capitalize">{user?.subscription_status}</span>
          {user?.subscription_expires_at && (
            <>
              {" "}&middot; Renews{" "}
              {new Date(user.subscription_expires_at).toLocaleDateString()}
            </>
          )}
        </p>
        <button
          onClick={openPortal}
          disabled={loading}
          className="mt-6 rounded-[--radius-pill] border border-border-light px-6 py-2.5 text-sm font-bold text-text-primary transition-colors hover:bg-primary-bg disabled:opacity-50"
        >
          {loading ? "Loading..." : "Manage Subscription"}
        </button>
      </div>
    </div>
  );
}
