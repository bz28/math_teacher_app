import type { Metadata } from "next";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import { InkCtaBand } from "@/components/site/ink-cta-band";
import { DistrictsHero } from "@/components/landing/districts/districts-hero";
import { ComplianceGrid } from "@/components/landing/districts/compliance-grid";
import { FederalComplianceMatrix } from "@/components/landing/districts/federal-compliance-matrix";
import { DataModelSafety } from "@/components/landing/districts/data-model-safety";
import { DeploymentTimeline } from "@/components/landing/districts/deployment-timeline";
import { PilotDataStrip } from "@/components/landing/districts/pilot-data-strip";
import { PaperworkBlock } from "@/components/landing/districts/paperwork-block";
import { DistrictFaq } from "@/components/landing/districts/district-faq";
import { districtFaqs, faqJsonLd, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "For school districts — Veradic AI",
  description:
    "Veradic AI is built to clear district procurement before it clears the classroom. FERPA + COPPA compliant, NDPA-ready, never trains on student data, single-classroom pilots available.",
  keywords: [
    "ed-tech FERPA",
    "ed-tech COPPA",
    "NDPA AI tutor",
    "ai tutor school district",
    "ai tutor procurement",
    "veradic for districts",
    "ai tutor data privacy",
  ],
  alternates: {
    canonical: `${SITE_URL}/for-districts`,
  },
  openGraph: {
    title: "Veradic AI for school districts",
    description:
      "Compliance, paperwork, and pilot path for superintendents and curriculum directors.",
    url: `${SITE_URL}/for-districts`,
  },
};

/**
 * /for-districts — the credibility document we email to superintendents
 * and curriculum directors. Different audience than the homepage
 * (procurement vs. teacher). The homepage convinces a teacher to push
 * Veradic up the chain; this page convinces the chain not to block it.
 *
 * Notebook design: graph paper with alternating white bands, ending on
 * the dark ink ask (send us your paperwork).
 */
export default function ForDistrictsPage() {
  return (
    <div className="site graph-paper flex min-h-full flex-1 flex-col">
      {/* FAQ JSON-LD scoped to the district FAQ set actually rendered
          on this page — different from the homepage's set, so each
          page exposes its own structured data. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd(districtFaqs)),
        }}
      />
      <Navbar />
      <main className="flex-1 overflow-x-clip">
        <DistrictsHero />
        <ComplianceGrid />
        <FederalComplianceMatrix />
        <DataModelSafety />
        <DeploymentTimeline />
        <PilotDataStrip />
        <PaperworkBlock />
        <DistrictFaq />
        <InkCtaBand
          headline="Send us your district’s paperwork. We’ve seen it."
          subhead="We’ll read it and reply within 5 business days. Most districts get a fully countersigned package in under two weeks."
          primaryLabel="Email support@veradicai.com"
          primaryHref="mailto:support@veradicai.com?subject=District%20paperwork%20%E2%80%94%20%5BDistrict%20name%5D"
          secondaryLabel="Book a 20-minute demo"
          secondaryHref="/demo"
        />
      </main>
      <Footer />
    </div>
  );
}
