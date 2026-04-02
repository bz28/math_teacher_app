import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { subjectBreadcrumbJsonLd } from "../layout";

export const metadata: Metadata = {
  title: "AI Physics Tutor — Step-by-Step Physics Help",
  description:
    "Struggling with mechanics, thermodynamics, or waves? Veradic AI breaks any physics problem into guided steps you actually understand, then generates unlimited practice until you master it.",
  keywords: [
    "AI physics tutor",
    "physics homework help",
    "physics solver",
    "step-by-step physics",
    "mechanics tutor",
    "thermodynamics help",
    "physics practice problems",
    "online physics tutor",
    "AI physics help",
  ],
  openGraph: {
    title: "Veradic AI — Your AI Physics Tutor",
    description:
      "Break any physics problem into steps you actually understand. Mechanics, energy, waves, and more.",
    url: "https://veradicai.com/subjects/physics",
  },
  twitter: {
    title: "Veradic AI — Your AI Physics Tutor",
    description:
      "Break any physics problem into steps you actually understand. Mechanics, energy, waves, and more.",
  },
  alternates: {
    canonical: "https://veradicai.com/subjects/physics",
  },
};

const physicsIcon = (
  <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </svg>
);

const examples = [
  { topic: "Mechanics", problem: "A 5 kg block slides down a 30° incline with friction μ = 0.2. Find the acceleration." },
  { topic: "Energy", problem: "A roller coaster starts at 40m height. What is its speed at the bottom?" },
  { topic: "Waves", problem: "A guitar string vibrates at 440 Hz with length 0.65m. Find the wave speed." },
  { topic: "Electricity", problem: "Three resistors (2Ω, 4Ω, 6Ω) are in parallel. Find the total resistance." },
  { topic: "Thermodynamics", problem: "How much heat is needed to raise 2 kg of water from 20°C to 100°C?" },
  { topic: "Optics", problem: "A convex lens has focal length 10 cm. Where is the image of an object at 25 cm?" },
];

const features = [
  {
    title: "Step-by-Step Solutions",
    description: "Every physics problem is broken into clear steps — identify forces, set up equations, solve, and verify. No hand-waving.",
  },
  {
    title: "Ask Questions at Any Step",
    description: "Not sure why F = ma applies here? Ask your AI tutor and get an explanation that connects the concept to the problem.",
  },
  {
    title: "Unlimited Practice Variations",
    description: "Same concept, different numbers and scenarios. Build real problem-solving intuition through varied repetition.",
  },
  {
    title: "Photo Scan Your Homework",
    description: "Snap a photo of your physics worksheet — diagrams and all. Veradic AI extracts the problems and guides you through each one.",
  },
];

export default function PhysicsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(subjectBreadcrumbJsonLd("Physics", "physics")),
        }}
      />
      <SubjectPage
      name="Physics"
      tagline="Your AI Physics Tutor"
      description="From mechanics to thermodynamics, Veradic AI breaks any physics problem into guided steps you actually understand — then generates unlimited practice until you master it."
      gradient="from-[#0984E3] to-[#74B9FF]"
      iconGradient="from-[#0984E3] to-[#74B9FF]"
      badgeColor="#0984E3"
      badgeBg="#E8F4FD"
      icon={physicsIcon}
      examples={examples}
      features={features}
    />
    </>
  );
}
