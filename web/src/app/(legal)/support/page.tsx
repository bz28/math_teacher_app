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

const LINK =
  "font-bold text-veradic underline underline-offset-2 transition-colors hover:text-veradic-dark";

/**
 * Support, in the same notebook layout as the other text pages: a header
 * on the graph paper, then one white sheet with the three ways to get
 * help, divided by rule lines.
 */
export default function SupportPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-24 md:px-8 md:pb-28">
      <header className="pb-10 pt-12 md:pb-14 md:pt-16">
        <h1 className="site-h1 max-w-[820px]">Veradic AI Support</h1>
        <p className="m-0 mt-5 max-w-[36em] text-lg leading-[1.55] text-ink-soft md:text-xl">
          Need help with Veradic? We&apos;re here for you.
        </p>
      </header>

      <div className="max-w-[760px] rounded-[4px] border border-hairline bg-white px-5 py-8 sm:px-10 sm:py-10 md:px-14 md:py-12">
        <section>
          <h2 className="m-0 text-[26px] font-black leading-[1.1] tracking-[-0.03em] md:text-[30px]">Email Us</h2>
          <p className="m-0 mt-4 text-[17px] leading-[1.7] text-[#2F3947]">
            The Veradic team typically responds within 24 hours.
          </p>
          <a href="mailto:support@veradicai.com" className={`mt-3 inline-block text-[17px] ${LINK}`}>
            support@veradicai.com
          </a>
        </section>

        <section className="mt-11 border-t border-rule pt-9">
          <h2 className="m-0 text-[26px] font-black leading-[1.1] tracking-[-0.03em] md:text-[30px]">Browse FAQ</h2>
          <p className="m-0 mt-4 text-[17px] leading-[1.7] text-[#2F3947]">
            Find quick answers to common questions about Veradic.
          </p>
          {/* Homepage no longer has an inline FAQ section; the
              canonical FAQ surface lives at /demo (general) and
              /for-districts (procurement-specific). Pointing
              support traffic at the demo page since that's the
              broader audience match. */}
          <Link href="/demo#faq" className={`mt-3 inline-block text-[17px] ${LINK}`}>
            View FAQ
          </Link>
        </section>

        <section className="mt-11 border-t border-rule pt-9">
          <h2 className="m-0 text-[26px] font-black leading-[1.1] tracking-[-0.03em] md:text-[30px]">Delete Your Account</h2>
          <p className="m-0 mt-4 text-[17px] leading-[1.7] text-[#2F3947]">
            You can delete your Veradic account and all associated data from your Account Settings, or by emailing{" "}
            <a href="mailto:support@veradicai.com" className={LINK}>
              support@veradicai.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
