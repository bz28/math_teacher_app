import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { HomeProblem } from "@/components/landing/home-problem";
import { HomePillars } from "@/components/landing/home-pillars";
import { HomeDemo } from "@/components/landing/home-demo";
import { HomeSubjects } from "@/components/landing/home-subjects";
import { FAQ } from "@/components/landing/faq";
import { CTA } from "@/components/landing/cta";
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
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
