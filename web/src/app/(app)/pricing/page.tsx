"use client";

import { useState } from "react";
import { useAuthStore } from "@/stores/auth";
import { useEntitlementStore } from "@/stores/entitlements";
import { promo as promoApi } from "@/lib/api";
import { purchasePlan, getManagementUrl, type PlanType } from "@/services/revenuecat";
import { CheckIcon } from "@/components/ui/icons";

const plans: {
  id: PlanType;
  name: string;
  price: string;
  period: string;
  perWeek: string | null;
  badge: string | null;
  trial: string | null;
  cta: string;
  recommended: boolean;
}[] = [
  {
    id: "weekly",
    name: "Weekly",
    price: "$2.99",
    period: "/week",
    perWeek: null,
    badge: null,
    trial: null,
    cta: "Subscribe",
    recommended: false,
  },
  {
    id: "annual",
    name: "Yearly",
    price: "$79.99",
    period: "/year",
    perWeek: "$1.54/week",
    badge: "Most Popular",
    trial: "3-day free trial",
    cta: "Start Free Trial",
    recommended: true,
  },
];

const comparisons = [
  { feature: "Problem sessions", free: "5 per day", pro: "Unlimited" },
  { feature: "Chat messages", free: "20 per day", pro: "Unlimited" },
  { feature: "Image scanning", free: "3 per day", pro: "Unlimited" },
  { feature: "Work diagnosis", free: "—", pro: "Full AI grading" },
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
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-extrabold text-text-primary">
          Unlock your full potential
        </h1>
        <p className="mt-3 text-lg text-text-secondary">
          No daily limits. No locked features. Just learn.
        </p>
      </div>

      {error && (
        <div className="mt-6 rounded-[--radius-md] bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Plan cards */}
      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`relative flex flex-col rounded-[--radius-xl] border-2 p-6 ${
              plan.recommended
                ? "border-primary bg-surface shadow-xl shadow-primary/10"
                : "border-border-light bg-surface"
            }`}
          >
            {plan.badge && (
              <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-5 py-1.5 text-xs font-bold text-white shadow-md">
                {plan.badge}
              </span>
            )}

            <h3 className="text-base font-bold text-text-secondary">{plan.name}</h3>

            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-5xl font-extrabold tracking-tight text-text-primary">{plan.price}</span>
              <span className="text-base text-text-muted">{plan.period}</span>
            </div>

            {plan.perWeek && (
              <p className="mt-1.5 text-sm font-semibold text-success">
                That&apos;s just {plan.perWeek} — save 49%
              </p>
            )}

            {plan.trial ? (
              <div className="mt-4 rounded-[--radius-md] bg-primary-bg px-4 py-2.5">
                <p className="text-sm font-bold text-primary">
                  Try free for 3 days
                </p>
                <p className="mt-0.5 text-xs text-primary/70">
                  You won&apos;t be charged today
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-text-muted">Cancel anytime, no commitment</p>
            )}

            <button
              onClick={() => handlePurchase(plan)}
              disabled={loading !== null}
              className={`mt-auto pt-6 w-full rounded-[--radius-pill] py-3.5 text-sm font-bold transition-all disabled:opacity-50 ${
                plan.recommended
                  ? "bg-primary text-white shadow-md shadow-primary/25 hover:bg-primary-dark hover:shadow-lg hover:shadow-primary/30"
                  : "border-2 border-border-light text-text-primary hover:border-primary hover:text-primary"
              }`}
            >
              {loading === plan.id ? "Loading..." : plan.cta}
            </button>
          </div>
        ))}
      </div>

      {/* Free vs Pro comparison */}
      <div className="mt-12">
        <h2 className="text-center text-sm font-bold uppercase tracking-wide text-text-muted">
          Free vs Pro
        </h2>
        <div className="mt-4 overflow-hidden rounded-[--radius-xl] border border-border-light">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-surface">
                <th className="px-5 py-3 text-left font-semibold text-text-secondary">Feature</th>
                <th className="px-5 py-3 text-center font-semibold text-text-secondary">Free</th>
                <th className="px-5 py-3 text-center font-semibold text-primary">Pro</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((row, i) => (
                <tr key={row.feature} className={i < comparisons.length - 1 ? "border-b border-border-light" : ""}>
                  <td className="px-5 py-3.5 font-medium text-text-primary">{row.feature}</td>
                  <td className="px-5 py-3.5 text-center text-text-muted">{row.free}</td>
                  <td className="px-5 py-3.5 text-center font-semibold text-text-primary">
                    <span className="inline-flex items-center gap-1.5">
                      <CheckIcon className="h-3.5 w-3.5 text-success" />
                      {row.pro}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <div className="mt-10 rounded-[--radius-xl] border border-success/30 bg-success/5 p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
          <CheckIcon className="inline h-6 w-6 shrink-0 text-success" />
        </div>
        <p className="text-lg font-bold text-text-primary">{success}</p>
        <p className="mt-1 text-sm text-text-secondary">Enjoy your Pro features!</p>
      </div>
    );
  }

  return (
    <div className="mt-10 text-center">
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
