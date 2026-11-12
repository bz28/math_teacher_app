import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { HomeIntegrity } from "@/components/landing/home-integrity";
import { HomeGrading } from "@/components/landing/home-grading";
import { HomeWorkspace } from "@/components/landing/home-workspace";
import { HomeCuriosity, HomePractice, HomeTrust } from "@/components/landing/home-students";
import { InkCtaBand } from "@/components/site/ink-cta-band";
import { Footer } from "@/components/landing/footer";

/**
 * Proof-forward landing, teacher side first, then the student side:
 * Hook → understanding check → grading by your rules → homework from your
 * chapter → practice → learning to use AI well → safe for students → Ask.
 * Each section shows a real product surface rather than asserting a claim.
 *
 * The notebook design ("the student's page"): the whole page is graph
 * paper, and every other section is a white band, so the rhythm is
 * grid, white, grid, white… ending on the dark ink ask. Demo sides
 * alternate so no two neighbouring sections share a shape.
 */
export default function Home() {
  return (
    <div className="site graph-paper flex min-h-full flex-1 flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <HomeIntegrity />
        <HomeGrading />
        <HomeWorkspace />
        <HomePractice />
        <HomeCuriosity />
        <HomeTrust />
        <InkCtaBand
          headline="Bring Veradic to your school."
          subhead="Book a 20-minute walkthrough — we'll show you the whole loop on your own material and get your classes set up."
          primaryLabel="Book a demo"
          primaryHref="/demo"
          secondaryLabel="For schools & districts"
          secondaryHref="/for-districts"
        />
      </main>
      <Footer />
    </div>
  );
}
