import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { HomeIntegrity } from "@/components/landing/home-integrity";
import { HomeGrading } from "@/components/landing/home-grading";
import { HomeWorkspace } from "@/components/landing/home-workspace";
import { HomeCuriosity, HomePractice, HomeTrust } from "@/components/landing/home-students";
import { CtaBand } from "@/components/landing/cta-band";
import { Footer } from "@/components/landing/footer";

/**
 * Proof-forward landing, teacher side first, then the student side:
 * Hook → understanding check → grading by your rules → homework from your
 * chapter → practice → learning to use AI well → safe for students → Ask.
 * Each section shows a real product surface rather than asserting a claim.
 * Rhythm: light, dark, alt, light, alt, dark, light, ink; demo sides
 * alternate so no two neighbouring sections share a shape.
 */
export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <HomeIntegrity />
        <HomeGrading />
        <HomeWorkspace />
        <HomePractice />
        <HomeCuriosity />
        <HomeTrust />
        {/* No eyebrow. Every section on this page opened with the same
            small uppercase label, which is most of why four different
            arguments read as one shape repeated — and the headline
            carries its own weight without one. The prop stays on
            CtaBand because /for-districts and the subject pages still
            pass it; this is a homepage decision, not a component one. */}
        <CtaBand
          headline="Bring Veradic to your school."
          subhead="Book a 20-minute walkthrough — we'll show you the whole loop on your own material and get your classes set up."
          primaryLabel="Book a demo"
          primaryHref="/demo"
          secondaryLabel="For schools & districts"
          secondaryHref="/for-districts"
        />
      </main>
      <Footer />
    </>
  );
}
