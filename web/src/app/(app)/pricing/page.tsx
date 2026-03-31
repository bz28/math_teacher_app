"use client";

import { useState } from "react";
import { useAuthStore } from "@/stores/auth";
import { stripe as stripeApi } from "@/lib/api";

const PRICE_MONTHLY = process.env.NEXT_PUBLIC_STRIPE_PRICE_MONTHLY ?? "";
const PRICE_YEARLY = process.env.NEXT_PUBLIC_STRIPE_PRICE_YEARLY ?? "";

const plans = [
  {
    id: "monthly",
    name: "Monthly",
    priceId: PRICE_MONTHLY,
    price: "$9.99",
    period: "/month",
    perMonth: null,
    badge: null,
    trial: null,
    cta: "Subscribe",
  },
  {
    id: "yearly",
    name: "Yearly",
    priceId: PRICE_YEARLY,
    price: "$59.99",
    period: "/year",
    perMonth: "$5.00/mo",
    badge: "Most Popular",
    trial: "7-day free trial",
    cta: "Start Free Trial",
  },
];

const proFeatures = [
  "Unlimited sessions",
  "Mock exams with timer",
  "Work diagnosis (AI grading)",
  "Image scanning",
  "Full session history",
];

export default function PricingPage() {
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (user?.is_pro) {
    return <ActiveSubscription />;
  }

  async function handleCheckout(plan: (typeof plans)[number]) {
    setLoading(plan.id);
    setError(null);
    try {
      const { checkout_url } = await stripeApi.createCheckoutSession(
        plan.priceId,
        `${window.location.origin}/pricing/success`,
        `${window.location.origin}/pricing`,
      );
      window.location.href = checkout_url;
    } catch {
      setError("Something went wrong. Please try again.");
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
              <p className="mt-1 text-sm font-medium text-success">{plan.perMonth} — Save 50%</p>
            )}
            {plan.trial && (
              <p className="mt-2 inline-block rounded-[--radius-sm] bg-primary-bg px-3 py-1 text-xs font-semibold text-primary">
                {plan.trial}
              </p>
            )}
            <ul className="mt-6 space-y-3">
              {proFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                  <CheckMark /> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => handleCheckout(plan)}
              disabled={loading !== null}
              className={`mt-6 w-full rounded-[--radius-pill] py-3 text-sm font-bold transition-colors disabled:opacity-50 ${
                plan.badge
                  ? "bg-primary text-white hover:bg-primary-dark"
                  : "border border-primary text-primary hover:bg-primary-bg"
              }`}
            >
              {loading === plan.id ? "Redirecting..." : plan.cta}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActiveSubscription() {
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(false);

  async function openPortal() {
    setLoading(true);
    try {
      const { portal_url } = await stripeApi.createPortalSession(
        `${window.location.origin}/pricing`,
      );
      window.location.href = portal_url;
    } catch {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10 text-center">
      <div className="rounded-[--radius-xl] border border-success/30 bg-success/5 p-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <CheckMark size={32} />
        </div>
        <h1 className="text-2xl font-extrabold text-text-primary">Pro Plan Active</h1>
        <p className="mt-2 text-text-secondary">
          Status: <span className="font-medium capitalize">{user?.subscription_status}</span>
          {user?.subscription_expires_at && (
            <>
              {" "}· Renews{" "}
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

function CheckMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="inline shrink-0 text-success"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
