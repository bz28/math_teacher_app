import type { Metadata } from "next";
import { SubjectPage } from "@/components/landing/subject-page";
import { SITE_URL } from "@/lib/seo";

// The root layout's title template adds "| Veradic AI".
const TITLE = "AI Physics for Classrooms: Conceptual to AP Physics";
const DESCRIPTION =
  "Veradic reads every step of your students' handwritten physics homework, units included, asks them to explain their own work, and drafts grades from your class rules for you to approve.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "ai physics for classrooms",
    "ai physics grading",
    "physics homework grading",
    "ai physics tutor for schools",
    "classroom physics ai",
    "ap physics homework",
    "ai for physics teachers",
    "physics practice problems",
    "veradic physics",
  ],
  openGraph: {
    title: `${TITLE} | Veradic AI`,
    description: DESCRIPTION,
    url: `${SITE_URL}/subjects/physics`,
  },
  twitter: {
    title: `${TITLE} | Veradic AI`,
    description: DESCRIPTION,
  },
  alternates: {
    canonical: `${SITE_URL}/subjects/physics`,
  },
};

export default function PhysicsPage() {
  return (
    <SubjectPage
      name="Physics"
      slug="physics"
      kicker="Physics, from conceptual physics to AP Physics C"
      headline="Physics homework where the units count."
      intro="Students photograph their handwritten work. Veradic asks each one about their own steps, drafts the grade from your class rules, and gives them more practice on what they missed. You approve every grade."
      sheet={{
        prompt: "A car at 72 km/h brakes to a stop in 4.0 s. Find its acceleration.",
        lines: ["a = (v − v₀) / t", "a = (0 − 72) / 4.0", "a = −18 m/s²"],
        circled: 1,
        description:
          "A student's handwritten work: a = (v − v₀) / t, then a = (0 − 72) / 4.0, then a = −18 m/s². The second line is circled in red: 72 is still in kilometres per hour, but the answer is written in metres per second squared.",
      }}
      question="72 is in km/h, but your answer is in m/s². What is 72 km/h in meters per second?"
      courses={["Conceptual Physics", "Physics", "AP Physics", "AP Physics C"]}
      coursesNote="Kinematics, forces, energy, waves, electricity, magnetism and modern physics."
      faqs={[
        {
          q: "Is physics as far along as math?",
          a: "Not yet. Math is Veradic’s most complete subject. Physics classes use the same homework, grading and practice, and we’d rather you judge it on your own problems: bring a chapter to the demo and we’ll run it live.",
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
      programDescription="Classroom physics for schools, from conceptual physics through AP Physics C: handwritten homework read step by step, understanding checks, grades drafted from the teacher's rules for the teacher to approve, and practice from teacher-approved problems."
    />
  );
}
