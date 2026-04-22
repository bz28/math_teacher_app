import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { calculusDemo } from "@/components/landing/demos/calculus-demo";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "AI Math Tutor for Schools: Algebra to Calculus | Veradic AI",
  description:
    "Veradic is the AI math tutor built for classrooms. Integrity checks, AI grading, and endless practice across algebra, geometry, calculus, and word problems.",
  keywords: [
    "ai math tutor for schools",
    "ai math tutor",
    "math homework help",
    "step by step math",
    "algebra tutor",
    "calculus help",
    "ai tutor for teachers",
    "classroom math ai",
    "chatgpt alternative math",
    "math practice problems",
    "veradic math tutor",
  ],
  openGraph: {
    title: "AI Math Tutor for Schools | Veradic AI",
    description:
      "Integrity checks, AI grading, and endless practice across algebra, geometry, calculus, and word problems.",
    url: `${SITE_URL}/subjects/math`,
  },
  twitter: {
    title: "AI Math Tutor for Schools | Veradic AI",
    description:
      "Integrity checks, AI grading, and endless practice across algebra, geometry, calculus, and word problems.",
  },
  alternates: {
    canonical: `${SITE_URL}/subjects/math`,
  },
};

const mathIcon = (
  <svg
    className="h-8 w-8"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="2" x2="12" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" />
  </svg>
);

const whyReasons = [
  "Covers the full math curriculum from middle school through AP Calculus BC. One tool, every class you teach.",
  "Shows work the way you show work: factor, simplify, solve, verify. Not a black box that spits out a final number.",
  "Catches the common mistakes you see every week (sign errors, missed steps, distribution errors) and walks students past them.",
];

const subjectProseBlock =
  "Every step in Veradic's walk-through explains why the move works — not just that it does. Students see why you factor before applying the quadratic formula, why a substitution makes the integral tractable, why a proof follows the order it does. The thinking is the point.";

export default function MathPage() {
  return (
    <SubjectPage
      name="Math"
      slug="math"
      tagline="AI math tutoring, built for classrooms."
      description="From pre-algebra through AP Calculus BC, Veradic walks every student through the thinking, so they get the answer, and they actually understand how they got there."
      detailedDescription="Whether your students are struggling with quadratic equations, fighting their way through calculus, or trying to write their first geometry proof, Veradic meets them where they are and guides them forward, one step at a time."
      educationalProgramDescription="AI-powered math tutoring for classrooms, covering pre-algebra, algebra, geometry, trigonometry, pre-calculus, AP Calculus, and statistics with step-by-step guidance and teacher-controlled content."
      badgeColor="#6C5CE7"
      icon={mathIcon}
      whyReasons={whyReasons}
      subjectProseBlock={subjectProseBlock}
      demoData={calculusDemo}
    />
  );
}
