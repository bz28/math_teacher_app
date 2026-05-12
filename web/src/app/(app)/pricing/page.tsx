"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { useEntitlementStore } from "@/stores/entitlements";
import { ApiError, billing } from "@/lib/api";
import { purchasePlan, getManagementUrl, type PlanType } from "@/services/revenuecat";
import { CheckIcon } from "@/components/ui/icons";

type PlanView = "student" | "teacher";

const TEACHER_PRO_FEATURES = [
  "Unlimited generated practice problems",
  "Unlimited AI grading drafts",
  "Save and reuse problem banks",
  "Cancel anytime — no commitment",
];

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
  // Suspense boundary so useSearchParams (CSR-only API) doesn't break
  // Next.js's prerender step — same pattern the register page uses.
  return (
    <Suspense>
      <PricingPageContent />
    </Suspense>
  );
}

function PricingPageContent() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Toggle defaults to whichever matches the user's role, with a URL
  // override (`?view=teacher` or `?view=student`) so a deep link can
  // jump straight to the teacher card from the homepage or workspace.
  const viewParam = searchParams.get("view");
  const defaultView: PlanView = user?.role === "teacher" ? "teacher" : "student";
  const view: PlanView = viewParam === "teacher" || viewParam === "student"
    ? viewParam
    : defaultView;

  function setView(next: PlanView) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    router.replace(`/pricing?${params.toString()}`);
  }

  // Pro users land on a status card instead of the plan picker.
  // Teachers and students use different billing providers, so we
  // route by subscription_provider (set by the webhook handler)
  // rather than by current role — that way an admin who flipped a
  // teacher's role to student doesn't accidentally route a Stripe-
  // paying user through the RevenueCat portal.
  if (user?.is_pro) {
    return user.subscription_provider === "stripe" ? (
      <ActiveTeacherSubscription />
    ) : (
      <ActiveSubscription />
    );
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
          {view === "teacher"
            ? "Pricing for teachers"
            : "Unlock your full potential"}
        </h1>
        <p className="mt-3 text-lg text-text-secondary">
          {view === "teacher"
            ? "Run more practice. Grade smarter. Cancel anytime."
            : "No daily limits. No locked features. Just learn."}
        </p>
      </div>

      {/* Role toggle — single pricing URL, two audiences. */}
      <div
        role="group"
        aria-label="Choose pricing view"
        className="mx-auto mt-6 flex max-w-xs rounded-[--radius-pill] border border-border-light bg-surface-alt p-1"
      >
        {(["student", "teacher"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`flex-1 rounded-[--radius-pill] px-4 py-2 text-sm font-semibold transition-colors ${
              view === v
                ? "bg-primary text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {v === "student" ? "I'm a student" : "I'm a teacher"}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-6 rounded-[--radius-md] bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Student plan cards — RevenueCat (existing behavior). Hidden
          when the teacher view is active; teacher card lives below. */}
      {view === "student" && (
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
      )}

      {/* Teacher Pro card — Stripe Checkout for solo teachers. */}
      {view === "teacher" && <TeacherProCard />}

      {/* Free vs Pro comparison (student-only — the feature comparisons
          describe student-side limits like "5 problem sessions/day"). */}
      {view === "student" && (
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

// Teacher Pro card — single SKU, $19/mo, Stripe Checkout. Visually
// mirrors the recommended student plan card so the page reads as
// "one product, two audiences" rather than two unrelated layouts.
function TeacherProCard() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
    };
  }, []);

  async function startCheckout() {
    setLoading(true);
    setError(null);
    // Fallback timeout: window.location.assign normally navigates
    // away before this fires, but if Stripe is slow / blocked /
    // popup-blocked, we re-enable the button after 8s with a
    // helpful message rather than stranding the user on "Loading...".
    loadingTimeoutRef.current = setTimeout(() => {
      setLoading(false);
      setError("Taking longer than expected. Please try again.");
    }, 8000);
    try {
      const { checkout_url } = await billing.teacherCheckout();
      window.location.assign(checkout_url);
    } catch (e) {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      // 401: session expired mid-flow. Route them to login with a
      // return-to so they don't lose their place.
      if (e instanceof ApiError && e.status === 401) {
        router.push("/login?return_to=/pricing?view=teacher");
        return;
      }
      setError("Checkout is not available right now. Please try again later.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-md">
      {error && (
        <div className="mb-4 rounded-[--radius-md] bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      <div className="relative flex flex-col rounded-[--radius-xl] border-2 border-primary bg-surface p-7 shadow-xl shadow-primary/10">
        <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-5 py-1.5 text-xs font-bold text-white shadow-md">
          For solo teachers
        </span>

        <h3 className="text-base font-bold text-text-secondary">Teacher Pro</h3>
        <p className="mt-1 text-sm text-text-muted">Unlimited AI problem generation</p>

        <div className="mt-3 flex items-baseline gap-1">
          <span className="text-5xl font-extrabold tracking-tight text-text-primary">$19</span>
          <span className="text-base text-text-muted">/month</span>
        </div>

        <ul className="mt-5 space-y-2.5">
          {TEACHER_PRO_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm text-text-primary">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={startCheckout}
          disabled={loading}
          className="mt-6 w-full rounded-[--radius-pill] bg-primary py-3.5 text-sm font-bold text-white shadow-md shadow-primary/25 transition-all hover:bg-primary-dark hover:shadow-lg hover:shadow-primary/30 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Upgrade to Pro"}
        </button>

        <p className="mt-4 text-center text-xs text-text-muted">
          School-wide pricing?{" "}
          <Link href="/demo" className="font-semibold text-primary hover:text-primary-dark">
            Book a demo →
          </Link>
        </p>
      </div>
    </div>
  );
}

// Pro teacher's status card. Mirrors ActiveSubscription but uses the
// Stripe customer portal (the student path goes through RevenueCat).
function ActiveTeacherSubscription() {
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The portal endpoint 404s without a stripe_customer_id (e.g. an
  // admin-set is_pro=true user, or a paid teacher whose customer
  // row was wiped). Disable the button up-front rather than showing
  // a generic error after the click.
  const canManage = user?.has_stripe_customer === true;

  async function openPortal() {
    setLoading(true);
    setError(null);
    try {
      const { portal_url } = await billing.teacherPortal();
      window.location.assign(portal_url);
    } catch {
      setError("Couldn't open the management portal. Please try again later.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10 text-center">
      <div className="rounded-[--radius-xl] border border-success/30 bg-success/5 p-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <CheckIcon className="inline h-8 w-8 shrink-0 text-success" />
        </div>
        <h1 className="text-2xl font-extrabold text-text-primary">Teacher Pro Active</h1>
        <p className="mt-2 text-text-secondary">
          Status: <span className="font-medium capitalize">{user?.subscription_status}</span>
          {user?.subscription_expires_at && (
            <>
              {" "}&middot; Renews{" "}
              {new Date(user.subscription_expires_at).toLocaleDateString()}
            </>
          )}
        </p>
        {error && (
          <p className="mt-4 text-sm text-error">{error}</p>
        )}
        <button
          onClick={openPortal}
          disabled={loading || !canManage}
          title={canManage ? undefined : "Subscription management is unavailable for this account. Contact support if you need to make a change."}
          className="mt-6 rounded-[--radius-pill] border border-border-light px-6 py-2.5 text-sm font-bold text-text-primary transition-colors hover:bg-primary-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Loading..." : "Manage Subscription"}
        </button>
      </div>
    </div>
  );
}
