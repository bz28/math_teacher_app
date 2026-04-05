"use client";

/* ================================================================
   Decorative scrolling topic columns on the left and right edges.
   Topics scroll in opposite directions for visual interest.
   Hidden on mobile — only visible on large screens.
   ================================================================ */

const ALL_TOPICS = {
  math: [
    "Algebra",
    "Calculus",
    "Geometry",
    "Trigonometry",
    "Statistics",
    "Linear Algebra",
    "Pre-Algebra",
    "Word Problems",
    "Quadratic Equations",
    "Derivatives",
    "Integrals",
    "Probability",
    "Matrices",
    "Polynomials",
    "Logarithms",
  ],
  physics: [
    "Mechanics",
    "Kinematics",
    "Thermodynamics",
    "Waves",
    "Optics",
    "Electricity",
    "Magnetism",
    "Energy",
    "Momentum",
    "Projectile Motion",
    "Circuits",
    "Free Fall",
    "Newton's Laws",
    "Work & Power",
    "Gravity",
  ],
  chemistry: [
    "Stoichiometry",
    "Balancing Equations",
    "Acids & Bases",
    "Organic Chemistry",
    "Thermochemistry",
    "Molarity",
    "Gas Laws",
    "Electrochemistry",
    "Reactions",
    "Molar Mass",
    "Bonding",
    "Periodic Table",
    "Oxidation",
    "Solutions",
    "Equilibrium",
  ],
  teacher: [
    "Auto-Grading",
    "Class Analytics",
    "Test Generator",
    "Student Progress",
    "Step-by-Step",
    "AI Tutoring",
    "Assignments",
    "Course Management",
    "Practice Sets",
    "Differentiation",
    "Real-Time Data",
    "Answer Keys",
    "Student Reports",
    "Curriculum",
    "Homework",
  ],
};

interface ScrollingTopicsProps {
  /** Which subjects to show. "all" shows everything, or pass a specific subject */
  subject?: "all" | "math" | "physics" | "chemistry" | "teacher";
}

export function ScrollingTopics({ subject = "all" }: ScrollingTopicsProps) {
  let leftItems: string[];
  let rightItems: string[];

  if (subject === "all") {
    // Main page: mix subjects on left, subtopics on right
    leftItems = ["Math", "Physics", "Chemistry", "Algebra", "Mechanics", "Stoichiometry", "Calculus", "Waves", "Reactions", "Geometry", "Optics", "Molarity", "Trigonometry", "Energy", "Gas Laws"];
    rightItems = ["Derivatives", "Kinematics", "Bonding", "Integrals", "Circuits", "Equilibrium", "Matrices", "Momentum", "Acids & Bases", "Logarithms", "Gravity", "Organic Chemistry", "Statistics", "Thermodynamics", "Electrochemistry"];
  } else {
    const topics = ALL_TOPICS[subject];
    const mid = Math.ceil(topics.length / 2);
    leftItems = topics.slice(0, mid);
    rightItems = topics.slice(mid);
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-0 hidden overflow-hidden xl:block" aria-hidden="true">
      {/* Left column — scrolls up */}
      <div className="absolute left-3 top-0 flex w-28 flex-col items-end 2xl:left-6 2xl:w-36">
        <div className="animate-scroll-up">
          <TopicList items={leftItems} />
          <TopicList items={leftItems} />
        </div>
      </div>

      {/* Right column — scrolls down */}
      <div className="absolute right-3 top-0 flex w-28 flex-col items-start 2xl:right-6 2xl:w-36">
        <div className="animate-scroll-down">
          <TopicList items={rightItems} />
          <TopicList items={rightItems} />
        </div>
      </div>
    </div>
  );
}

function TopicList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-col gap-6 py-4">
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="block text-right text-xs font-medium text-text-muted/30 2xl:text-sm"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
