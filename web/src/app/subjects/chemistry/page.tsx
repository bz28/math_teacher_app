import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { subjectBreadcrumbJsonLd } from "../layout";

export const metadata: Metadata = {
  title: "AI Chemistry Tutor — Step-by-Step Chemistry Help",
  description:
    "Struggling with balancing equations, stoichiometry, or organic chemistry? Veradic AI breaks any chemistry problem into guided steps you actually understand, then generates unlimited practice until you master it.",
  keywords: [
    "AI chemistry tutor",
    "chemistry homework help",
    "chemistry solver",
    "step-by-step chemistry",
    "stoichiometry help",
    "organic chemistry tutor",
    "chemistry practice problems",
    "online chemistry tutor",
    "AI chemistry help",
    "balancing equations",
  ],
  openGraph: {
    title: "Veradic AI — Your AI Chemistry Tutor",
    description:
      "Break any chemistry problem into steps you actually understand. Reactions, stoichiometry, organic chemistry, and more.",
    url: "https://veradicai.com/subjects/chemistry",
  },
  twitter: {
    title: "Veradic AI — Your AI Chemistry Tutor",
    description:
      "Break any chemistry problem into steps you actually understand. Reactions, stoichiometry, organic chemistry, and more.",
  },
  alternates: {
    canonical: "https://veradicai.com/subjects/chemistry",
  },
};

const chemIcon = (
  <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 3h6v7l4 9H5l4-9V3z" />
    <line x1="9" y1="3" x2="15" y2="3" />
  </svg>
);

const examples = [
  { topic: "Balancing Equations", problem: "Balance: Fe₂O₃ + CO → Fe + CO₂" },
  { topic: "Stoichiometry", problem: "How many grams of CO₂ are produced from burning 10g of CH₄?" },
  { topic: "Acids & Bases", problem: "Find the pH of a 0.05 M HCl solution" },
  { topic: "Organic Chemistry", problem: "Draw the product of an SN2 reaction between CH₃Br and NaOH" },
  { topic: "Thermochemistry", problem: "Calculate the enthalpy change for: 2H₂ + O₂ → 2H₂O" },
  { topic: "Molarity", problem: "How many mL of 2M NaOH are needed to neutralize 50 mL of 1M H₂SO₄?" },
];

const features = [
  {
    title: "Step-by-Step Solutions",
    description: "Every chemistry problem is broken down — identify reactants, balance equations, apply stoichiometry, and verify units. Clear and systematic.",
  },
  {
    title: "Ask Questions at Any Step",
    description: "Not sure why you need to find the limiting reagent first? Ask your AI tutor and get a clear, concept-linked explanation.",
  },
  {
    title: "Unlimited Practice Variations",
    description: "Practice balancing different equations, calculating different molarities — build confidence through repetition with fresh problems.",
  },
  {
    title: "Photo Scan Your Homework",
    description: "Snap a photo of your chemistry worksheet. Veradic AI reads the problems — including chemical formulas — and guides you step by step.",
  },
];

export default function ChemistryPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(subjectBreadcrumbJsonLd("Chemistry", "chemistry")),
        }}
      />
      <SubjectPage
      name="Chemistry"
      tagline="Your AI Chemistry Tutor"
      description="From balancing equations to organic chemistry, Veradic AI breaks any chemistry problem into guided steps you actually understand — then generates unlimited practice until you master it."
      gradient="from-success to-[#55EFC4]"
      iconGradient="from-success to-[#55EFC4]"
      badgeColor="#00B894"
      badgeBg="#E8F8F5"
      icon={chemIcon}
      examples={examples}
      features={features}
    />
    </>
  );
}
