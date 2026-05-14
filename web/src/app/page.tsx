import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { HomeProblem } from "@/components/landing/home-problem";
import { HomeIntegrity } from "@/components/landing/home-integrity";
import { HomeWorkspace } from "@/components/landing/home-workspace";
import { HomeOutcomes } from "@/components/landing/home-outcomes";
import { HomeDistrictsTeaser } from "@/components/landing/home-districts-teaser";
import { CtaBand } from "@/components/landing/cta-band";
import { Footer } from "@/components/landing/footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <HomeProblem />
        <HomeIntegrity />
        <HomeWorkspace />
        <HomeOutcomes />
        <HomeDistrictsTeaser />
        {/* Final-CTA reframe to match the lead-with-self-serve hero.
            Previously pitched 'Bring Veradic to your school. Book a
            walkthrough' — single school-focused ask that orphaned every
            solo teacher who'd scrolled the whole page. Now offers both
            paths: 'Start free' as primary (matches navbar + hero),
            'Book a 20-min demo' as secondary for buyers who want to
            talk first. */}
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
