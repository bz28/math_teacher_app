import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Veradic AI Physics Tutor — Step-by-Step Physics Help",
  description:
    "Veradic is an AI physics tutor that breaks any mechanics, thermodynamics, or waves problem into guided steps you actually understand, then generates unlimited practice.",
  keywords: [
    "veradic",
    "veradic physics tutor",
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
    title: "Veradic — Your AI Physics Tutor",
    description:
      "Break any physics problem into steps you actually understand. Mechanics, energy, waves, and more.",
    url: `${SITE_URL}/subjects/physics`,
  },
  twitter: {
    title: "Veradic — Your AI Physics Tutor",
    description:
      "Break any physics problem into steps you actually understand. Mechanics, energy, waves, and more.",
  },
  alternates: {
    canonical: `${SITE_URL}/subjects/physics`,
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
  { topic: "Magnetism", problem: "A 2m wire carrying 5A is in a 0.3T magnetic field. Find the force on the wire." },
  { topic: "Kinematics", problem: "A ball is thrown upward at 20 m/s. How high does it go and when does it return?" },
];

const features = [
  {
    title: "Step-by-Step Solutions",
    description: "Every physics problem is broken into clear steps — identify forces, draw free-body diagrams, set up equations, solve, and verify. No hand-waving.",
  },
  {
    title: "Ask Questions at Any Step",
    description: "Not sure why F = ma applies here? Ask your Veradic tutor and get an explanation that connects the concept to the problem.",
  },
  {
    title: "Unlimited Practice Variations",
    description: "Same physics concept, different masses, angles, and velocities. Veradic generates fresh scenarios so you build real problem-solving intuition.",
  },
  {
    title: "Photo Scan Your Homework",
    description: "Snap a photo of your physics worksheet — diagrams and all. Veradic extracts the problems and guides you through each one.",
  },
];

export default function PhysicsPage() {
  return (
    <>
      <SubjectPage
        name="Physics"
        slug="physics"
        tagline="Your AI Physics Tutor"
        description="From mechanics to thermodynamics, Veradic breaks any physics problem into guided steps you actually understand — then generates unlimited practice until you master it."
        detailedDescription="Whether you're analyzing projectile motion, calculating electric fields, or solving thermodynamics problems, Veradic walks you through the physics step by step. Understand the why, not just the how."
        educationalProgramDescription="AI-powered physics tutoring with step-by-step solutions for mechanics, thermodynamics, waves, and more."
        gradient="from-[#0984E3] to-[#74B9FF]"
        badgeColor="#0984E3"
        icon={physicsIcon}
        examples={examples}
        features={features}
      />
    </>
  );
}
