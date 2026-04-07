import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { Subjects } from "@/components/landing/subjects";
import { CTA } from "@/components/landing/cta";
import { Footer } from "@/components/landing/footer";
export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Features />
        <Subjects />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
