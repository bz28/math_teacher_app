import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "AI Math Tutor for Schools — Algebra to Calculus | Veradic AI",
  description:
    "Veradic is the AI math tutor built for classrooms. Guides students through algebra, geometry, calculus, and word problems step by step — without ever giving the answer away.",
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
      "Guides students through algebra, geometry, calculus, and word problems step by step — without ever giving the answer away.",
    url: `${SITE_URL}/subjects/math`,
  },
  twitter: {
    title: "AI Math Tutor for Schools | Veradic AI",
    description:
      "Guides students through algebra, geometry, calculus, and word problems step by step — without ever giving the answer away.",
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

const topics = [
  "Pre-Algebra",
  "Algebra I",
  "Algebra II",
  "Geometry",
  "Trigonometry",
  "Pre-Calculus",
  "Calculus AB",
  "Calculus BC",
  "Statistics",
  "Word Problems",
  "Proofs",
  "Linear Algebra",
];

const differentiators = [
  {
    title: "Proper LaTeX, not plain text",
    description:
      "Every expression, equation, and proof renders with textbook-quality typography. No more fighting with asterisks and slashes.",
  },
  {
    title: "Word problems the right way",
    description:
      "Veradic doesn't just solve word problems — it teaches students how to translate English into math, which is the part they actually struggle with.",
  },
  {
    title: "Proofs, step by step",
    description:
      "Geometry and algebra proofs are broken into logical moves. Students learn the structure, not just the answer.",
  },
];

const whyReasons = [
  "Covers the full math curriculum from middle school through AP Calculus BC — one tool, every class you teach.",
  "Shows work the way you show work: factor, simplify, solve, verify. Not a black box that spits out a final number.",
  "Catches the common mistakes you see every week (sign errors, missed steps, distribution errors) and walks students past them.",
];

const demo = {
  problem:
    "A rectangle has a perimeter of 36 meters. If its length is 4 meters more than twice its width, find its dimensions.",
  steps: [
    {
      label: "Start with what you know",
      body: "The perimeter is 36 and the length has a specific relationship to the width. Can you write down both facts before we pick an equation?",
    },
    {
      label: "Set up your variables",
      body: "Let w be the width. How would you express the length in terms of w based on the problem?",
    },
    {
      label: "Build the perimeter equation",
      body: "The perimeter of a rectangle is 2(length + width). Plug in what you just wrote for length and set it equal to 36.",
    },
    {
      label: "Solve for the width",
      body: "You now have one equation with one unknown. Distribute, combine like terms, and isolate w.",
    },
    {
      label: "Check your answer",
      body: "Plug w back in, find the length, and verify that the perimeter really does equal 36. I'll wait for your work.",
    },
  ],
};

// Kept for backward compat with existing SEO schema generation
const examples = [
  { topic: "Algebra", problem: "Solve for x: 3x² + 7x - 20 = 0" },
  { topic: "Calculus", problem: "Find the derivative of f(x) = x³ ln(x)" },
  { topic: "Word Problems", problem: "A train leaves at 60 mph, another at 80 mph — when do they meet?" },
  { topic: "Geometry", problem: "Find the area of a triangle with vertices at (1,2), (4,6), and (7,1)" },
];

const features = [
  { title: "Step-by-Step Solutions", description: "Every math problem is decomposed into clear, logical steps." },
  { title: "Ask Questions at Any Step", description: "Students can ask why — and get an explanation tailored to their level." },
  { title: "Unlimited Practice", description: "Fresh variations on any problem so students build real fluency." },
  { title: "Photo Scan Homework", description: "Snap a worksheet, Veradic extracts every problem and walks through each one." },
];

export default function MathPage() {
  return (
    <SubjectPage
      name="Math"
      slug="math"
      tagline="AI math tutoring, built for classrooms."
      description="From pre-algebra through AP Calculus BC, Veradic walks every student through the thinking — so they get the answer, and they actually understand how they got there."
      detailedDescription="Whether your students are struggling with quadratic equations, fighting their way through calculus, or trying to write their first geometry proof, Veradic meets them where they are and guides them forward — one step at a time."
      educationalProgramDescription="AI-powered math tutoring for classrooms, covering pre-algebra, algebra, geometry, trigonometry, pre-calculus, AP Calculus, and statistics with step-by-step guidance and teacher-controlled content."
      badgeColor="#6C5CE7"
      icon={mathIcon}
      examples={examples}
      features={features}
      topics={topics}
      differentiators={differentiators}
      whyReasons={whyReasons}
      demo={demo}
    />
  );
}
