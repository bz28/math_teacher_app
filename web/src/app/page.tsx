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
