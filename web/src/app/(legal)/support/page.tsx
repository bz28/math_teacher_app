import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Need help with Veradic AI? Contact the Veradic AI support team or browse our FAQ for quick answers.",
  alternates: {
    canonical: `${SITE_URL}/support`,
  },
};

export default function SupportPage() {
  return (
    <div className="px-6 pt-32 pb-20 md:pt-40 md:pb-28">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
          Veradic AI Support
        </h1>
        <p className="mt-4 text-lg text-text-secondary">
          Need help with Veradic? We&apos;re here for you.
        </p>

        <div className="mt-12 space-y-6">
          {/* Email */}
          <div className="rounded-[--radius-lg] border border-border-light bg-surface p-6">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[--radius-md] bg-primary-bg text-primary">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-text-primary">Email Us</h2>
            <p className="mt-2 text-text-secondary">
              The Veradic team typically responds within 24 hours.
            </p>
            <a
              href="mailto:support@veradicai.com"
              className="mt-4 inline-flex items-center gap-2 text-primary font-semibold hover:underline"
            >
              support@veradicai.com
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
          </div>

          {/* FAQ */}
          <div className="rounded-[--radius-lg] border border-border-light bg-surface p-6">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[--radius-md] bg-primary-bg text-primary">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-text-primary">Browse FAQ</h2>
            <p className="mt-2 text-text-secondary">
              Find quick answers to common questions about Veradic.
            </p>
            <Link
              href="/#faq"
              className="mt-4 inline-flex items-center gap-2 text-primary font-semibold hover:underline"
            >
              View FAQ
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>

          {/* Account deletion note */}
          <div className="rounded-[--radius-lg] border border-border-light bg-surface p-6">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[--radius-md] bg-error-light text-error">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-text-primary">Delete Your Account</h2>
            <p className="mt-2 text-text-secondary">
              You can delete your Veradic account and all associated data from your Account Settings, or by emailing <a href="mailto:support@veradicai.com" className="text-primary hover:underline">support@veradicai.com</a>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
