import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { chemistryDemo } from "@/components/landing/demos/chemistry-demo";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "AI Chemistry Tutor for Schools: Stoichiometry to Organic | Veradic AI",
  description:
    "Veradic is the AI chemistry tutor built for classrooms. Guides students through stoichiometry, bonding, equilibrium, thermodynamics, and organic step by step, without ever giving the answer away.",
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
      "Guides students through stoichiometry, bonding, equilibrium, and organic chemistry step by step, without ever giving the answer away.",
    url: `${SITE_URL}/subjects/chemistry`,
  },
  twitter: {
    title: "AI Chemistry Tutor for Schools | Veradic AI",
    description:
      "Guides students through stoichiometry, bonding, equilibrium, and organic chemistry step by step, without ever giving the answer away.",
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

const whyReasons = [
  "Covers the full chemistry curriculum from intro chem through AP Chemistry and organic. One tool for every section in your course.",
  "Handles the unit gymnastics chemistry demands (grams to moles to molecules) without students giving up halfway through.",
  "Renders real molecular structures so students understand bonding and reactivity instead of just memorizing names.",
];

const subjectProseBlock =
  "Structures render as real molecules, not strings of letters. Every reaction step explains the electrons, the bonds, and the logic — not just memorized products. Students build intuition about why chemistry works, not just what to write down.";

export default function ChemistryPage() {
  return (
    <SubjectPage
      name="Chemistry"
      slug="chemistry"
      tagline="AI chemistry tutoring, built for classrooms."
      description="From balancing equations through organic synthesis, Veradic walks every student through the chemistry, so they get the answer, and they actually understand the reaction behind it."
      detailedDescription="Whether your students are just learning the periodic table or prepping for AP Chemistry, Veradic meets them where they are and guides them forward through stoichiometry, bonding, equilibrium, and beyond, one step at a time."
      educationalProgramDescription="AI-powered chemistry tutoring for classrooms, covering atoms, bonding, stoichiometry, thermochemistry, equilibrium, acids and bases, electrochemistry, kinetics, and organic chemistry with step-by-step guidance and teacher-controlled content."
      badgeColor="#00B894"
      icon={chemIcon}
      whyReasons={whyReasons}
      subjectProseBlock={subjectProseBlock}
      demoData={chemistryDemo}
    />
  );
}
