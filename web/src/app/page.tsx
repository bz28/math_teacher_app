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
