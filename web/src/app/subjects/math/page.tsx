import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { subjectBreadcrumbJsonLd } from "../layout";

export const metadata: Metadata = {
  title: "AI Math Tutor — Step-by-Step Math Help",
  description:
    "Struggling with algebra, calculus, or word problems? Veradic AI breaks any math problem into guided steps you actually understand, then generates unlimited practice until you master it.",
  keywords: [
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
    title: "Veradic AI — Your AI Math Tutor",
    description:
      "Break any math problem into steps you actually understand. Algebra, calculus, word problems, and more.",
    url: "https://veradicai.com/subjects/math",
  },
  twitter: {
    title: "Veradic AI — Your AI Math Tutor",
    description:
      "Break any math problem into steps you actually understand. Algebra, calculus, word problems, and more.",
  },
  alternates: {
    canonical: "https://veradicai.com/subjects/math",
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
];

const features = [
  {
    title: "Step-by-Step Solutions",
    description: "Every math problem is decomposed into clear, logical steps. No skipping — you see exactly how to get from question to answer.",
  },
  {
    title: "Ask Questions at Any Step",
    description: "Confused by a step? Ask your AI tutor why, and get an explanation tailored to your level — not a textbook paragraph.",
  },
  {
    title: "Unlimited Practice Variations",
    description: "Master a concept by solving similar problems. Veradic AI generates fresh variations so you build fluency, not memorization.",
  },
  {
    title: "Photo Scan Your Homework",
    description: "Snap a photo of your math worksheet. Veradic AI extracts every problem and queues them up for step-by-step learning.",
  },
];

export default function MathPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(subjectBreadcrumbJsonLd("Math", "math")),
        }}
      />
      <SubjectPage
      name="Math"
      tagline="Your AI Math Tutor"
      description="From algebra to calculus, Veradic AI breaks any math problem into guided steps you actually understand — then generates unlimited practice until you master it."
      gradient="from-primary to-primary-light"
      iconGradient="from-primary to-primary-light"
      badgeColor="#6C5CE7"
      badgeBg="#F0EDFF"
      icon={mathIcon}
      examples={examples}
      features={features}
    />
    </>
  );
}
