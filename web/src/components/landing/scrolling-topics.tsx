"use client";

/* ================================================================
   TopicCloud — decorative scattered topic words behind hero sections.
   Positioned in two faded columns on the left and right edges so they
   don't overlap the centered hero content. Visible on lg+ screens.
   ================================================================ */

const TOPIC_POOLS: Record<string, string[]> = {
  math: [
    "Quadratics", "Derivatives", "Integrals", "Trigonometry",
    "Probability", "Factoring", "Vectors", "Limits",
    "Matrices", "Geometry", "Statistics", "Calculus",
  ],
  physics: [
    "Kinematics", "Momentum", "Circuits", "Waves",
    "Optics", "Torque", "Gravity", "Relativity",
    "Thermodynamics", "Friction", "Electric Fields", "Magnetism",
  ],
  chemistry: [
    "Stoichiometry", "Molarity", "pH Scale", "Titration",
    "Gas Laws", "Redox Reactions", "Bonding", "Entropy",
    "Equilibrium", "Electrochemistry", "Lewis Structures", "Calorimetry",
  ],
  teacher: [
    "Auto-Grading", "Class Analytics", "Student Progress", "Test Generator",
    "AI Tutoring", "Step-by-Step Help", "Practice Sets", "Assignments",
    "Progress Tracking", "Question Banks", "Adaptive Learning", "Error Analysis",
  ],
};

const ALL_TOPICS_LEFT = [
  "Quadratics", "Kinematics", "Stoichiometry", "Derivatives",
  "Trigonometry", "Circuits", "pH Scale", "Integrals",
];
const ALL_TOPICS_RIGHT = [
  "Momentum", "Linear Algebra", "Optics", "Gas Laws",
  "Probability", "Lewis Structures", "Factoring", "Entropy",
];

interface TopicCloudProps {
  subject?: "all" | "math" | "physics" | "chemistry" | "teacher";
}

export function TopicCloud({ subject = "all" }: TopicCloudProps) {
  let leftItems: string[];
  let rightItems: string[];

  if (subject === "all") {
    leftItems = ALL_TOPICS_LEFT;
    rightItems = ALL_TOPICS_RIGHT;
  } else {
    const topics = TOPIC_POOLS[subject] ?? ALL_TOPICS_LEFT;
    const mid = Math.ceil(topics.length / 2);
    leftItems = topics.slice(0, mid);
    rightItems = topics.slice(mid);
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 hidden overflow-hidden lg:block"
      aria-hidden="true"
    >
      {/* Left column */}
      <div className="absolute left-6 top-0 flex h-full w-32 flex-col items-start justify-center gap-5 2xl:left-12 2xl:w-40">
        <div
          className="flex flex-col gap-4"
          style={{
            maskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
          }}
        >
          {leftItems.map((topic, i) => (
            <span
              key={`l-${i}`}
              className="text-xs font-medium text-text-muted/30 2xl:text-sm"
            >
              {topic}
            </span>
          ))}
        </div>
      </div>

      {/* Right column */}
      <div className="absolute right-6 top-0 flex h-full w-32 flex-col items-end justify-center gap-5 2xl:right-12 2xl:w-40">
        <div
          className="flex flex-col items-end gap-4"
          style={{
            maskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
          }}
        >
          {rightItems.map((topic, i) => (
            <span
              key={`r-${i}`}
              className="text-right text-xs font-medium text-text-muted/30 2xl:text-sm"
            >
              {topic}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export { TopicCloud as ScrollingTopics };
