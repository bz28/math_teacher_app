import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { SITE_URL } from "@/lib/seo";

// The root layout's title template adds "| Veradic AI".
const TITLE = "AI Math for Classrooms: Pre-Algebra to AP Calculus";
const DESCRIPTION =
  "Veradic reads every step of your students' handwritten math homework, asks them to explain their own work, and drafts grades from your class rules for you to approve.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "ai math for classrooms",
    "ai math grading",
    "math homework grading",
    "ai math tutor for schools",
    "classroom math ai",
    "algebra homework",
    "calculus homework",
    "ai for math teachers",
    "math practice problems",
    "veradic math",
  ],
  openGraph: {
    title: `${TITLE} | Veradic AI`,
    description: DESCRIPTION,
    url: `${SITE_URL}/subjects/math`,
  },
  twitter: {
    title: `${TITLE} | Veradic AI`,
    description: DESCRIPTION,
  },
  alternates: {
    canonical: `${SITE_URL}/subjects/math`,
  },
};

export default function MathPage() {
  return (
    <SubjectPage
      name="Math"
      slug="math"
      kicker="Math, from pre-algebra to AP Calculus BC"
      headline="Math homework, read one line at a time."
      intro="Students photograph their handwritten work. Veradic asks each one about their own steps, drafts the grade from your class rules, and gives them more practice on what they missed. You approve every grade."
      sheet={{
        prompt: "Solve for x.",
        lines: ["2(x − 3) = 4x + 8", "2x − 3 = 4x + 8", "−11 = 2x", "x = −5.5"],
        circled: 1,
        description:
          "A student's handwritten work: 2(x − 3) = 4x + 8 becomes 2x − 3 = 4x + 8, so the 2 was multiplied by x but not by the 3. That line is circled in red. The student ends at x = −5.5.",
      }}
      question="The 2 is outside the brackets. Which terms inside does it multiply?"
      courses={[
        "Pre-algebra",
        "Algebra I",
        "Geometry",
        "Algebra II",
        "Trigonometry",
        "Precalculus",
        "Statistics",
        "AP Calculus AB",
        "AP Calculus BC",
      ]}
      faqs={[
        {
          q: "Can students just get the answer from it?",
          a: "No. When they’re stuck it asks for the next step and explains the idea behind it. It only talks about your class’s problems, and you can read every understanding-check conversation.",
        },
        {
          q: "Who decides the grade?",
          a: "You do. Veradic drafts it from your rules, and nothing reaches a student until you approve it.",
        },
        {
          q: "Do I have to write the problems?",
          a: "No. Point Veradic at your chapter and it writes problems with full worked solutions. It checks the answers, and you review and approve them before students see any.",
        },
      ]}
      programDescription="Classroom math for schools, from pre-algebra through AP Calculus BC: handwritten homework read step by step, understanding checks, grades drafted from the teacher's rules for the teacher to approve, and practice from teacher-approved problems."
    />
  );
}
