import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { Section } from "@/components/landing/section";
import { Eyebrow } from "@/components/landing/eyebrow";
import { StepsAnimation } from "@/components/landing/steps-animation";
import { mathDemo } from "@/components/landing/demos/math-demo";
import { HomeSubjects } from "@/components/landing/home-subjects";
import { HomeTeachers } from "@/components/landing/home-teachers";
import { CtaBand } from "@/components/landing/cta-band";
import { Footer } from "@/components/landing/footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />

        {/* ── Product demo — dark section for visual impact ── */}
        <Section variant="invert" id="demo">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow variant="invert">See it in action</Eyebrow>
            <h2 className="mt-6 text-display-md text-[color:var(--color-invert-text)]">
              This is what your students see.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-[color:var(--color-invert-text-muted)]">
              Every problem, broken into steps they can actually follow.
              One at a time, at their own pace.
            </p>
          </div>
          <div className="mx-auto mt-14 max-w-2xl">
            <StepsAnimation data={mathDemo} />
          </div>
        </Section>

        <HomeTeachers />
        <HomeSubjects />
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
