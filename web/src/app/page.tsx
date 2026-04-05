import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { Subjects } from "@/components/landing/subjects";
import { FAQ } from "@/components/landing/faq";
import { CTA } from "@/components/landing/cta";
import { Footer } from "@/components/landing/footer";
import { ScrollingTopics } from "@/components/landing/scrolling-topics";

export default function Home() {
  return (
    <>
      <ScrollingTopics subject="all" />
      <Navbar />
      <main>
        <Hero />
        <Features />
        <Subjects />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
