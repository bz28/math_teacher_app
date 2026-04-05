"use client";

/* ================================================================
   Decorative scrolling topic columns on the left and right edges.
   Positioned absolute — must be placed inside a relative container
   (e.g. the hero section). Only visible on xl+ screens.
   ================================================================ */

const ALL_TOPICS = {
  math: [
    "Algebra", "Calculus", "Geometry", "Trigonometry", "Statistics",
    "Linear Algebra", "Pre-Algebra", "Word Problems", "Quadratic Equations",
    "Derivatives", "Integrals", "Probability", "Matrices", "Polynomials", "Logarithms",
  ],
  physics: [
    "Mechanics", "Kinematics", "Thermodynamics", "Waves", "Optics",
    "Electricity", "Magnetism", "Energy", "Momentum", "Projectile Motion",
    "Circuits", "Free Fall", "Newton's Laws", "Work & Power", "Gravity",
  ],
  chemistry: [
    "Stoichiometry", "Balancing Equations", "Acids & Bases", "Organic Chemistry",
    "Thermochemistry", "Molarity", "Gas Laws", "Electrochemistry", "Reactions",
    "Molar Mass", "Bonding", "Periodic Table", "Oxidation", "Solutions", "Equilibrium",
  ],
  teacher: [
    "Auto-Grading", "Class Analytics", "Test Generator", "Student Progress",
    "Step-by-Step", "AI Tutoring", "Assignments", "Course Management",
    "Practice Sets", "Differentiation", "Real-Time Data", "Answer Keys",
    "Student Reports", "Curriculum", "Homework",
  ],
};

interface ScrollingTopicsProps {
  subject?: "all" | "math" | "physics" | "chemistry" | "teacher";
}

export function ScrollingTopics({ subject = "all" }: ScrollingTopicsProps) {
  let leftItems: string[];
  let rightItems: string[];

  if (subject === "all") {
    leftItems = ["Algebra", "Mechanics", "Stoichiometry", "Calculus", "Waves", "Reactions", "Geometry", "Optics", "Molarity", "Trigonometry", "Energy", "Gas Laws", "Derivatives", "Kinematics", "Bonding"];
    rightItems = ["Integrals", "Circuits", "Equilibrium", "Matrices", "Momentum", "Acids & Bases", "Logarithms", "Gravity", "Organic Chemistry", "Statistics", "Thermodynamics", "Electrochemistry", "Probability", "Free Fall", "Periodic Table"];
  } else {
    const topics = ALL_TOPICS[subject];
    const mid = Math.ceil(topics.length / 2);
    leftItems = topics.slice(0, mid);
    rightItems = topics.slice(mid);
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-0 hidden overflow-hidden xl:block" aria-hidden="true">
      {/* Left column — scrolls up, left-aligned */}
      <div className="absolute left-4 top-0 w-28 2xl:left-8 2xl:w-36">
        <div className="animate-scroll-up">
          <TopicList items={leftItems} align="left" />
          <TopicList items={leftItems} align="left" />
        </div>
      </div>

      {/* Right column — scrolls down, right-aligned */}
      <div className="absolute right-4 top-0 w-28 2xl:right-8 2xl:w-36">
        <div className="animate-scroll-down">
          <TopicList items={rightItems} align="right" />
          <TopicList items={rightItems} align="right" />
        </div>
      </div>
    </div>
  );
}

function TopicList({ items, align }: { items: string[]; align: "left" | "right" }) {
  return (
    <div className="flex flex-col gap-6 py-4">
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className={`block text-xs font-medium text-text-muted/30 2xl:text-sm ${
            align === "right" ? "text-right" : "text-left"
          }`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}
