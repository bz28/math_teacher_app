import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { HomeProblem } from "@/components/landing/home-problem";
import { HomeIntegrity } from "@/components/landing/home-integrity";
import { HomeWorkspace } from "@/components/landing/home-workspace";
import { HomeOutcomes } from "@/components/landing/home-outcomes";
import { HomeSubjects } from "@/components/landing/home-subjects";
import { HomeDistrictsTeaser } from "@/components/landing/home-districts-teaser";
import { FAQ } from "@/components/landing/faq";
import { CtaBand } from "@/components/landing/cta-band";
import { Footer } from "@/components/landing/footer";
import { faqJsonLd, faqs } from "@/lib/seo";

export default function Home() {
  return (
    <>
      {/* FAQ JSON-LD scoped to the homepage's actual question set. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd(faqs)),
        }}
      />
      <Navbar />
      <main>
        <Hero />
        <HomeProblem />
        <HomeIntegrity />
        <HomeWorkspace />
        <HomeOutcomes />
        <HomeSubjects />
        <HomeDistrictsTeaser />
        <FAQ />
        <CtaBand
          eyebrow="Ready when you are"
          headline="Bring Veradic to your school."
          subhead="Book a 20-minute walkthrough. We'll show you what the integrity checker catches."
        />
      </main>
      <Footer />
    </>
  );
}
