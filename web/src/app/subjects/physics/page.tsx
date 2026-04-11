import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { physicsDemo } from "@/components/landing/demos/physics-demo";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "AI Physics Tutor for Schools: Mechanics to Modern Physics | Veradic AI",
  description:
    "Veradic is the AI physics tutor built for classrooms. Guides students through kinematics, forces, energy, electricity, and waves step by step, without ever giving the answer away.",
  keywords: [
    "ai physics tutor for schools",
    "ai physics tutor",
    "physics homework help",
    "step by step physics",
    "mechanics tutor",
    "ap physics tutor",
    "ai tutor for teachers",
    "classroom physics ai",
    "chatgpt alternative physics",
    "physics practice problems",
    "veradic physics tutor",
  ],
  openGraph: {
    title: "AI Physics Tutor for Schools | Veradic AI",
    description:
      "Guides students through kinematics, forces, energy, electricity, and waves step by step, without ever giving the answer away.",
    url: `${SITE_URL}/subjects/physics`,
  },
  twitter: {
    title: "AI Physics Tutor for Schools | Veradic AI",
    description:
      "Guides students through kinematics, forces, energy, electricity, and waves step by step, without ever giving the answer away.",
  },
  alternates: {
    canonical: `${SITE_URL}/subjects/physics`,
  },
};

const physicsIcon = (
  <svg
    className="h-8 w-8"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="2" />
    <ellipse cx="12" cy="12" rx="10" ry="4" />
    <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
  </svg>
);

const topics = [
  "Kinematics",
  "Forces & Newton's Laws",
  "Energy & Work",
  "Momentum",
  "Circular Motion",
  "Gravity",
  "Waves",
  "Sound",
  "Optics",
  "Electricity",
  "Magnetism",
  "Thermodynamics",
  "Modern Physics",
];

const differentiators = [
  {
    title: "Units that never drift",
    description:
      "Veradic tracks units through every step (meters, seconds, newtons, joules) and catches mismatches before they become wrong answers.",
  },
  {
    title: "Multi-step problems, actually broken down",
    description:
      "Most physics problems are two, three, or four sub-problems glued together. Veradic teaches students to see and separate them.",
  },
  {
    title: "Concept before calculation",
    description:
      "Students are asked what physics applies before they're asked to do arithmetic. You build intuition, not just plug-and-chug.",
  },
];

const whyReasons = [
  "Covers the full physics curriculum from conceptual physics through AP Physics C: mechanics, electricity, magnetism, and modern physics.",
  "Walks students through free-body diagrams, unit conversions, and energy conservation: the moves that matter, not just the final numbers.",
  "Catches the unit errors, sign errors, and vector-component mistakes that trip up every physics student at least once a week.",
];

// Legacy props retained for schema generation
const examples = [
  { topic: "Mechanics", problem: "A 5 kg block slides down a 30° incline with friction μ = 0.2. Find the acceleration." },
  { topic: "Energy", problem: "A roller coaster starts at 40m height. What is its speed at the bottom?" },
  { topic: "Waves", problem: "A guitar string vibrates at 440 Hz with length 0.65m. Find the wave speed." },
  { topic: "Electricity", problem: "Three resistors (2Ω, 4Ω, 6Ω) are in parallel. Find the total resistance." },
];

const features = [
  { title: "Step-by-Step Solutions", description: "Every physics problem is broken into clear steps." },
  { title: "Ask Questions at Any Step", description: "Ask your tutor why a concept applies." },
  { title: "Unlimited Practice", description: "Fresh variations on any problem." },
  { title: "Photo Scan Homework", description: "Snap a worksheet, Veradic extracts every problem." },
];

export default function PhysicsPage() {
  return (
    <SubjectPage
      name="Physics"
      slug="physics"
      tagline="AI physics tutoring, built for classrooms."
      description="From kinematics through modern physics, Veradic walks every student through the reasoning, so they get the answer, and they actually understand the physics behind it."
      detailedDescription="Whether your students are drawing their first free-body diagram, working through projectile motion, or prepping for the AP Physics exam, Veradic meets them where they are and guides them forward, one step at a time."
      educationalProgramDescription="AI-powered physics tutoring for classrooms, covering kinematics, forces, energy, waves, electricity, magnetism, and modern physics with step-by-step guidance and teacher-controlled content."
      badgeColor="#0984E3"
      icon={physicsIcon}
      examples={examples}
      features={features}
      topics={topics}
      differentiators={differentiators}
      whyReasons={whyReasons}
      demoData={physicsDemo}
    />
  );
}
