import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { ScrollingTopics } from "@/components/landing/scrolling-topics";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Veradic AI Chemistry Tutor — Step-by-Step Chemistry Help",
  description:
    "Veradic is an AI chemistry tutor that breaks any equation balancing, stoichiometry, or organic chemistry problem into guided steps you actually understand.",
  keywords: [
    "veradic",
    "veradic chemistry tutor",
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
    title: "Veradic — Your AI Chemistry Tutor",
    description:
      "Break any chemistry problem into steps you actually understand. Reactions, stoichiometry, organic chemistry, and more.",
    url: `${SITE_URL}/subjects/chemistry`,
  },
  twitter: {
    title: "Veradic — Your AI Chemistry Tutor",
    description:
      "Break any chemistry problem into steps you actually understand. Reactions, stoichiometry, organic chemistry, and more.",
  },
  alternates: {
    canonical: `${SITE_URL}/subjects/chemistry`,
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
  { topic: "Gas Laws", problem: "A gas at 2 atm and 300K is heated to 450K at constant volume. Find the new pressure." },
  { topic: "Electrochemistry", problem: "Calculate the standard cell potential for a Zn/Cu galvanic cell." },
];

const features = [
  {
    title: "Step-by-Step Solutions",
    description: "Every chemistry problem is broken down — identify reactants and products, balance equations step by step, apply stoichiometric ratios, and verify units. Clear and systematic.",
  },
  {
    title: "Ask Questions at Any Step",
    description: "Not sure why you need to find the limiting reagent first? Ask your Veradic tutor and get a clear, concept-linked explanation.",
  },
  {
    title: "Unlimited Practice Variations",
    description: "Practice balancing different types of reactions, calculating yields, and converting between moles and grams. Veradic generates fresh problems so you build confidence through repetition.",
  },
  {
    title: "Photo Scan Your Homework",
    description: "Snap a photo of your chemistry worksheet. Veradic reads the problems — including chemical formulas — and guides you step by step.",
  },
];

export default function ChemistryPage() {
  return (
    <>
      <ScrollingTopics subject="chemistry" />
      <SubjectPage
        name="Chemistry"
        slug="chemistry"
        tagline="Your AI Chemistry Tutor"
        description="From balancing equations to organic chemistry, Veradic breaks any chemistry problem into guided steps you actually understand — then generates unlimited practice until you master it."
        detailedDescription="Whether you're balancing redox reactions, calculating molar masses, or working through organic synthesis, Veradic breaks down each chemistry problem into manageable steps. Build real understanding of the science."
        educationalProgramDescription="AI-powered chemistry tutoring with step-by-step solutions for reactions, stoichiometry, organic chemistry, and more."
        gradient="from-success to-[#55EFC4]"
        badgeColor="#00B894"
        icon={chemIcon}
        examples={examples}
        features={features}
      />
    </>
  );
}
