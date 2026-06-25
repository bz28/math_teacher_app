import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { HomeIntegrity } from "@/components/landing/home-integrity";
import { HomeWorkspace } from "@/components/landing/home-workspace";
import { CtaBand } from "@/components/landing/cta-band";
import { Footer } from "@/components/landing/footer";

/**
 * Lean, proof-forward landing: Hook → Integrity demo → Homework demo → Ask.
 * The two animated demos *show* the value, so the old prose Problem and
 * Outcomes sections (which asserted/re-narrated what the demos prove) were
 * cut. Rhythm alternates light → dark → light → dark.
 */
export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <HomeIntegrity />
        <HomeWorkspace />
        <CtaBand
          eyebrow="Ready when you are"
          headline="Start teaching with Veradic today."
          subhead="Generate your first 10 problems free, or book a 20-minute walkthrough for your school."
          primaryLabel="Start free"
          primaryHref="/register?role=teacher"
          secondaryLabel="Book a 20-min demo"
          secondaryHref="/demo"
        />
      </main>
      <Footer />
    </>
  );
}
