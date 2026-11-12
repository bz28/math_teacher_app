import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { SITE_URL } from "@/lib/seo";

// The root layout's title template adds "| Veradic AI".
const TITLE = "AI Chemistry for Classrooms: Intro to AP Chemistry";
const DESCRIPTION =
  "Veradic reads every step of your students' handwritten chemistry homework, asks them to explain their own work, and drafts grades from your class rules for you to approve.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "ai chemistry for classrooms",
    "ai chemistry grading",
    "chemistry homework grading",
    "ai chemistry tutor for schools",
    "classroom chemistry ai",
    "ap chemistry homework",
    "stoichiometry practice",
    "balancing equations",
    "ai for chemistry teachers",
    "veradic chemistry",
  ],
  openGraph: {
    title: `${TITLE} | Veradic AI`,
    description: DESCRIPTION,
    url: `${SITE_URL}/subjects/chemistry`,
  },
  twitter: {
    title: `${TITLE} | Veradic AI`,
    description: DESCRIPTION,
  },
  alternates: {
    canonical: `${SITE_URL}/subjects/chemistry`,
  },
};

export default function ChemistryPage() {
  return (
    <SubjectPage
      name="Chemistry"
      slug="chemistry"
      kicker="Chemistry, from intro chemistry to AP Chemistry"
      headline="Chemistry homework where the equation has to balance."
      intro="Students photograph their handwritten work. Veradic asks each one about their own steps, drafts the grade from your class rules, and gives them more practice on what they missed. You approve every grade."
      sheet={{
        prompt: "How many moles of water form when 3.0 mol of O₂ reacts with hydrogen?",
        lines: ["H₂ + O₂ → H₂O", "O₂ : H₂O = 1 : 1", "3.0 mol O₂ → 3.0 mol H₂O"],
        circled: 0,
        description:
          "A student's handwritten work: H₂ + O₂ → H₂O, circled in red because it is not balanced. From it the student reads a one-to-one ratio of O₂ to H₂O and gets 3.0 mol H₂O.",
      }}
      question="Count the oxygen atoms on each side of your equation. Do they match?"
      courses={["Intro Chemistry", "Chemistry", "AP Chemistry", "Organic Chemistry"]}
      coursesNote="Stoichiometry, bonding, thermochemistry, equilibrium, acids and bases, electrochemistry and kinetics."
      faqs={[
        {
          q: "Is chemistry as far along as math?",
          a: "Not yet. Math is Veradic’s most complete subject. Chemistry classes use the same homework, grading and practice, and we’d rather you judge it on your own problems: bring a chapter to the demo and we’ll run it live.",
        },
        {
          q: "Can students just get the answer from it?",
          a: "No. When they’re stuck it asks for the next step and explains the idea behind it. It only talks about your class’s problems, and you can read every understanding-check conversation.",
        },
        {
          q: "Who decides the grade?",
          a: "You do. Veradic drafts it from your rules, and nothing reaches a student until you approve it.",
        },
      ]}
      programDescription="Classroom chemistry for schools, from intro chemistry through AP Chemistry: handwritten homework read step by step, understanding checks, grades drafted from the teacher's rules for the teacher to approve, and practice from teacher-approved problems."
    />
  );
}
