import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { HomeProblem } from "@/components/landing/home-problem";
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
        <HomeProblem />
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
