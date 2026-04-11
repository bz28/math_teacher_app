import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { HomeProblem } from "@/components/landing/home-problem";
import { HomePillars } from "@/components/landing/home-pillars";
import { HomeDemo } from "@/components/landing/home-demo";
import { HomeSubjects } from "@/components/landing/home-subjects";
import { HomeTeachers } from "@/components/landing/home-teachers";
import { HomeStudents } from "@/components/landing/home-students";
import { HomeIntegrity } from "@/components/landing/home-integrity";
import { TestimonialMarquee } from "@/components/landing/testimonial-marquee";
import { FAQ } from "@/components/landing/faq";
import { CtaBand } from "@/components/landing/cta-band";
import { Footer } from "@/components/landing/footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <HomeProblem />
        <HomePillars />
        <HomeDemo />
        <HomeSubjects />
        <HomeTeachers />
        <HomeStudents />
        <HomeIntegrity />
        <TestimonialMarquee />
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
