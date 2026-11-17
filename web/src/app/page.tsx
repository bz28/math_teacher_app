import type { Metadata } from "next";
import { SkipToMainLink } from "@/components/shared/skip-to-main-link";
import s from "@/components/landing/board/home.module.css";
import { Footer } from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import {
  Close,
  Faq,
  FoundingSchools,
  Hero,
  HowItWorks,
  LearnStory,
  Monday,
  Outcomes,
  Practice,
  Prep,
  Rules,
  WhyNow,
} from "@/components/landing/board/sections";

export const metadata: Metadata = {
  title: { absolute: "Veradic AI: AI that helps students understand their math homework" },
  description:
    "AI can give students the answer. Veradic helps them understand it. Students explain their own steps, teachers get every grade drafted by their rules, and see who still needs them.",
  alternates: { canonical: "https://veradicai.com" },
};

/**
 * The homepage, "At the Board". The story, top to bottom:
 * the answer is easy now → why now → a copied answer becomes a lesson
 * (the understanding check teaches; the teacher's view is the side effect)
 * → what builds test scores → how it works → the teacher's Monday →
 * students learn to use AI well → prep → responsible AI → founding schools
 * → questions → the ask.
 */
export default function Home() {
  return (
    <div className={`${s.home} flex min-h-full flex-1 flex-col`}>
      <SkipToMainLink />
      <Navbar />
      <main id="main-content" className="flex-1">
        <Hero />
        <WhyNow />
        <LearnStory />
        <Outcomes />
        <HowItWorks />
        <Monday />
        <Practice />
        <Prep />
        <Rules />
        <FoundingSchools />
        <Faq />
        <Close />
      </main>
      <Footer />
    </div>
  );
}
