import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { physicsDemo } from "@/components/landing/demos/physics-demo";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "AI Physics Tutor for Schools: Mechanics to Modern Physics | Veradic AI",
  description:
    "Veradic is the AI physics tutor built for classrooms. Integrity checks, AI grading, and endless practice across kinematics, forces, energy, electricity, and waves.",
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
      "Integrity checks, AI grading, and endless practice across kinematics, forces, energy, electricity, and waves.",
    url: `${SITE_URL}/subjects/physics`,
  },
  twitter: {
    title: "AI Physics Tutor for Schools | Veradic AI",
    description:
      "Integrity checks, AI grading, and endless practice across kinematics, forces, energy, electricity, and waves.",
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

const whyReasons = [
  "Covers the full physics curriculum from conceptual physics through AP Physics C: mechanics, electricity, magnetism, and modern physics.",
  "Walks students through free-body diagrams, unit conversions, and energy conservation: the moves that matter, not just the final numbers.",
  "Catches the unit errors, sign errors, and vector-component mistakes that trip up every physics student at least once a week.",
];

const subjectProseBlock =
  "Every problem starts with the physics, not the math. Students see which principle applies before they touch an equation — and they walk through free-body diagrams and unit tracking step by step, the way you'd teach at the board.";

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
      whyReasons={whyReasons}
      subjectProseBlock={subjectProseBlock}
      demoData={physicsDemo}
    />
  );
}
