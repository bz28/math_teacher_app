import type { Metadata } from "next";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import { CtaBand } from "@/components/landing/cta-band";
import { FAQ } from "@/components/landing/faq";
import { DistrictsHero } from "@/components/landing/districts/districts-hero";
import { ComplianceGrid } from "@/components/landing/districts/compliance-grid";
import { FederalComplianceMatrix } from "@/components/landing/districts/federal-compliance-matrix";
import { DataModelSafety } from "@/components/landing/districts/data-model-safety";
import { DeploymentTimeline } from "@/components/landing/districts/deployment-timeline";
import { PilotDataStrip } from "@/components/landing/districts/pilot-data-strip";
import { PaperworkBlock } from "@/components/landing/districts/paperwork-block";
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
 */
export default function ForDistrictsPage() {
  return (
    <>
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
      <main>
        <DistrictsHero />
        <ComplianceGrid />
        <FederalComplianceMatrix />
        <DataModelSafety />
        <DeploymentTimeline />
        <PilotDataStrip />
        <PaperworkBlock />
        <FAQ
          items={districtFaqs}
          heading="What district leaders ask."
        />
        <CtaBand
          headline="Bring Veradic to your district."
          subhead="Send us your paperwork. We'll handle the rest."
          primaryLabel="Email us"
          primaryHref="mailto:support@veradicai.com?subject=Veradic%20%E2%80%94%20%5BDistrict%20name%5D"
          secondaryLabel="Book a 20-min demo"
          secondaryHref="/demo"
        />
      </main>
      <Footer />
    </>
  );
}
