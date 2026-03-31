"use client";

import Link from "next/link";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const plans = [
  {
    name: "Monthly",
    price: "$9.99",
    period: "/month",
    badge: null,
    trial: null,
    cta: "Subscribe",
    features: [
      "Unlimited sessions",
      "Mock exams with timer",
      "Work diagnosis (AI grading)",
      "Image scanning",
      "Full session history",
    ],
  },
  {
    name: "Yearly",
    price: "$59.99",
    period: "/year",
    perMonth: "$5.00/mo",
    badge: "Most Popular",
    trial: "7-day free trial",
    cta: "Start Free Trial",
    features: [
      "Unlimited sessions",
      "Mock exams with timer",
      "Work diagnosis (AI grading)",
      "Image scanning",
      "Full session history",
    ],
  },
];

const freeFeatures = [
  "3 sessions per day",
  "Step-by-step learning",
  "Chat with AI tutor",
  "Last 5 sessions in history",
];

export function Pricing() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="pricing"
      ref={ref}
      className="px-6 py-20 md:py-28"
    >
      <div className="mx-auto max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <h2 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
            Simple, Transparent Pricing
          </h2>
          <p className="mt-4 text-lg text-text-secondary">
            Start free. Upgrade when you need more.
          </p>
        </motion.div>

        {/* Free tier */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.1, duration: 0.5 }}
          className="mb-8 rounded-[--radius-xl] border border-border-light bg-surface p-6 text-center"
        >
          <h3 className="text-lg font-bold text-text-primary">Free</h3>
          <p className="mt-1 text-sm text-text-secondary">No credit card required</p>
          <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1">
            {freeFeatures.map((f) => (
              <span key={f} className="text-sm text-text-secondary">
                <CheckMark /> {f}
              </span>
            ))}
          </div>
        </motion.div>

        {/* Pro plans */}
        <div className="grid gap-6 sm:grid-cols-2">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.15 + 0.1 * i, duration: 0.5 }}
              className={`relative rounded-[--radius-xl] border p-6 ${
                plan.badge
                  ? "border-primary bg-surface shadow-lg shadow-primary/5"
                  : "border-border-light bg-surface"
              }`}
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
                <p className="mt-1 text-sm font-medium text-success">
                  {plan.perMonth} — Save 50%
                </p>
              )}
              {plan.trial && (
                <p className="mt-2 rounded-[--radius-sm] bg-primary-bg px-3 py-1 text-xs font-semibold text-primary inline-block">
                  {plan.trial}
                </p>
              )}
              <ul className="mt-6 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                    <CheckMark /> {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className={`mt-6 block rounded-[--radius-pill] py-3 text-center text-sm font-bold transition-colors ${
                  plan.badge
                    ? "bg-primary text-white hover:bg-primary-dark"
                    : "border border-primary text-primary hover:bg-primary-bg"
                }`}
              >
                {plan.cta}
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CheckMark() {
  return (
    <svg className="inline h-4 w-4 shrink-0 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
