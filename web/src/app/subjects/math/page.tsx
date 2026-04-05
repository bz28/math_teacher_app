import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { ScrollingTopics } from "@/components/landing/scrolling-topics";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Veradic AI Math Tutor — Step-by-Step Math Help",
  description:
    "Veradic is an AI math tutor that breaks any algebra, calculus, or word problem into guided steps you actually understand, then generates unlimited practice until you master it.",
  keywords: [
    "veradic",
    "veradic math tutor",
    "AI math tutor",
    "math homework help",
    "math solver",
    "step-by-step math",
    "algebra tutor",
    "calculus help",
    "math practice problems",
    "online math tutor",
    "AI math help",
  ],
  openGraph: {
    title: "Veradic — Your AI Math Tutor",
    description:
      "Break any math problem into steps you actually understand. Algebra, calculus, word problems, and more.",
    url: `${SITE_URL}/subjects/math`,
  },
  twitter: {
    title: "Veradic — Your AI Math Tutor",
    description:
      "Break any math problem into steps you actually understand. Algebra, calculus, word problems, and more.",
  },
  alternates: {
    canonical: `${SITE_URL}/subjects/math`,
  },
};

const mathIcon = (
  <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="2" x2="12" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" />
  </svg>
);

const examples = [
  { topic: "Algebra", problem: "Solve for x: 3x² + 7x - 20 = 0" },
  { topic: "Calculus", problem: "Find the derivative of f(x) = x³ ln(x)" },
  { topic: "Word Problems", problem: "A train leaves at 60 mph, another at 80 mph — when do they meet?" },
  { topic: "Geometry", problem: "Find the area of a triangle with vertices at (1,2), (4,6), and (7,1)" },
  { topic: "Trigonometry", problem: "Prove that sin²θ + cos²θ = 1 using the unit circle" },
  { topic: "Linear Algebra", problem: "Find the eigenvalues of the matrix [[3,1],[1,3]]" },
  { topic: "Statistics", problem: "Find the standard deviation of the data set: 4, 8, 6, 5, 3" },
  { topic: "Pre-Algebra", problem: "Simplify the expression: 3(2x - 4) + 5x - 7" },
];

const features = [
  {
    title: "Step-by-Step Solutions",
    description: "Every math problem is decomposed into clear, logical steps — factor, simplify, solve, and verify. You see exactly how to get from question to answer, whether it's algebra or calculus.",
  },
  {
    title: "Ask Questions at Any Step",
    description: "Confused by a step? Ask your Veradic tutor why, and get an explanation tailored to your level — not a textbook paragraph.",
  },
  {
    title: "Unlimited Practice Variations",
    description: "Solved a quadratic equation? Now try five more with different coefficients. Veradic generates fresh math variations so you build fluency, not memorization.",
  },
  {
    title: "Photo Scan Your Homework",
    description: "Snap a photo of your math worksheet. Veradic extracts every problem and queues them up for step-by-step learning.",
  },
];

export default function MathPage() {
  return (
    <>
      <ScrollingTopics subject="math" />
      <SubjectPage
        name="Math"
        slug="math"
        tagline="Your AI Math Tutor"
        description="From algebra to calculus, Veradic breaks any math problem into guided steps you actually understand — then generates unlimited practice until you master it."
        detailedDescription="Whether you're tackling quadratic equations in algebra class, computing integrals in AP Calculus, or solving geometry proofs, Veradic guides you through every step at your own pace. No more staring at solutions you don't understand."
        educationalProgramDescription="AI-powered math tutoring with step-by-step solutions for algebra, calculus, geometry, and more."
        gradient="from-primary to-primary-light"
        badgeColor="#6C5CE7"
        icon={mathIcon}
        examples={examples}
        features={features}
      />
    </>
  );
}
