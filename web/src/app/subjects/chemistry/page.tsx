import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "AI Chemistry Tutor for Schools — Stoichiometry to Organic | Veradic AI",
  description:
    "Veradic is the AI chemistry tutor built for classrooms. Guides students through stoichiometry, bonding, equilibrium, thermodynamics, and organic step by step — without ever giving the answer away.",
  keywords: [
    "ai chemistry tutor for schools",
    "ai chemistry tutor",
    "chemistry homework help",
    "step by step chemistry",
    "stoichiometry help",
    "ap chemistry tutor",
    "organic chemistry tutor",
    "ai tutor for teachers",
    "classroom chemistry ai",
    "chatgpt alternative chemistry",
    "balancing equations",
    "veradic chemistry tutor",
  ],
  openGraph: {
    title: "AI Chemistry Tutor for Schools | Veradic AI",
    description:
      "Guides students through stoichiometry, bonding, equilibrium, and organic chemistry step by step — without ever giving the answer away.",
    url: `${SITE_URL}/subjects/chemistry`,
  },
  twitter: {
    title: "AI Chemistry Tutor for Schools | Veradic AI",
    description:
      "Guides students through stoichiometry, bonding, equilibrium, and organic chemistry step by step — without ever giving the answer away.",
  },
  alternates: {
    canonical: `${SITE_URL}/subjects/chemistry`,
  },
};

const chemIcon = (
  <svg
    className="h-8 w-8"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 2v7.31" />
    <path d="M14 9.3V2" />
    <path d="M8.5 2h7" />
    <path d="M14 9.3a6.5 6.5 0 1 1-4 0" />
  </svg>
);

const topics = [
  "Atoms & Elements",
  "Periodic Trends",
  "Chemical Bonding",
  "Naming Compounds",
  "Balancing Equations",
  "Stoichiometry",
  "Gas Laws",
  "Solutions & Molarity",
  "Thermochemistry",
  "Equilibrium",
  "Acids & Bases",
  "Redox & Electrochemistry",
  "Kinetics",
  "Organic Chemistry",
];

const differentiators = [
  {
    title: "Molecules rendered, not described",
    description:
      "Veradic renders real molecular structures from SMILES notation — students see the actual bonds, not just a string of letters.",
  },
  {
    title: "Stoichiometry that teaches the why",
    description:
      "Mole ratios, limiting reagents, percent yield — every step is explained in the context of the reaction, not as memorized formulas.",
  },
  {
    title: "Balances equations with the student",
    description:
      "Instead of showing a pre-balanced equation, Veradic asks students to try, then guides them toward the fix when they're off.",
  },
];

const whyReasons = [
  "Covers the full chemistry curriculum from intro chem through AP Chemistry and organic — one tool for every section in your course.",
  "Handles the unit gymnastics chemistry demands — grams to moles to molecules — without students giving up halfway through.",
  "Renders real molecular structures so students understand bonding and reactivity instead of just memorizing names.",
];

const demo = {
  problem:
    "How many grams of CO₂ are produced when 16 grams of methane (CH₄) are burned completely in oxygen?",
  steps: [
    {
      label: "Write the balanced equation",
      body: "Complete combustion of methane produces CO₂ and H₂O. Try to write and balance it before we move on.",
    },
    {
      label: "Convert grams to moles",
      body: "You have 16 g of CH₄. What's the molar mass of CH₄, and how many moles does that work out to?",
    },
    {
      label: "Use the mole ratio",
      body: "Look at your balanced equation. What's the ratio of CH₄ to CO₂? Apply that ratio to the moles you just found.",
    },
    {
      label: "Convert moles back to grams",
      body: "You now have moles of CO₂. Multiply by the molar mass of CO₂ to get your final answer in grams.",
    },
    {
      label: "Sanity check",
      body: "Does your answer make sense? You started with 16 g of carbon-containing fuel — the carbon can't disappear, so the answer should reflect where it went.",
    },
  ],
};

// Legacy props retained for schema generation
const examples = [
  { topic: "Balancing Equations", problem: "Balance: Fe₂O₃ + CO → Fe + CO₂" },
  { topic: "Stoichiometry", problem: "How many grams of CO₂ are produced from burning 10g of CH₄?" },
  { topic: "Acids & Bases", problem: "Find the pH of a 0.05 M HCl solution" },
  { topic: "Organic Chemistry", problem: "Draw the product of an SN2 reaction between CH₃Br and NaOH" },
];

const features = [
  { title: "Step-by-Step Solutions", description: "Every chemistry problem broken into clear steps." },
  { title: "Ask Questions at Any Step", description: "Ask your tutor why a concept applies." },
  { title: "Unlimited Practice", description: "Fresh variations on any reaction or problem." },
  { title: "Photo Scan Homework", description: "Snap a worksheet, Veradic extracts every problem." },
];

export default function ChemistryPage() {
  return (
    <SubjectPage
      name="Chemistry"
      slug="chemistry"
      tagline="AI chemistry tutoring, built for classrooms."
      description="From balancing equations through organic synthesis, Veradic walks every student through the chemistry — so they get the answer, and they actually understand the reaction behind it."
      detailedDescription="Whether your students are just learning the periodic table or prepping for AP Chemistry, Veradic meets them where they are and guides them forward through stoichiometry, bonding, equilibrium, and beyond — one step at a time."
      educationalProgramDescription="AI-powered chemistry tutoring for classrooms, covering atoms, bonding, stoichiometry, thermochemistry, equilibrium, acids and bases, electrochemistry, kinetics, and organic chemistry with step-by-step guidance and teacher-controlled content."
      badgeColor="#00B894"
      icon={chemIcon}
      examples={examples}
      features={features}
      topics={topics}
      differentiators={differentiators}
      whyReasons={whyReasons}
      demo={demo}
    />
  );
}
