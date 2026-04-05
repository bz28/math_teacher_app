"use client";

/* ================================================================
   Decorative scrolling topic columns on the left and right edges.
   Positioned absolute — must be placed inside a relative container
   (e.g. the hero section). Only visible on xl+ screens.
   ================================================================ */

const ALL_TOPICS = {
  math: [
    // Elementary
    "Addition", "Subtraction", "Multiplication", "Division", "Fractions",
    "Decimals", "Percentages", "Place Value", "Rounding", "Number Lines",
    // Middle school
    "Pre-Algebra", "Ratios", "Proportions", "Integers", "Order of Operations",
    "Exponents", "Square Roots", "Coordinate Plane", "Inequalities", "Expressions",
    // Algebra
    "Linear Equations", "Quadratics", "Factoring", "Polynomials", "Slope",
    "Systems of Equations", "Absolute Value", "Radical Expressions", "Functions",
    // Geometry
    "Triangles", "Circles", "Area & Perimeter", "Volume", "Congruence",
    "Similarity", "Pythagorean Theorem", "Proofs", "Transformations", "Angles",
    // Trigonometry
    "Sine & Cosine", "Tangent", "Unit Circle", "Identities", "Law of Sines",
    "Law of Cosines", "Radians", "Inverse Trig",
    // Pre-Calculus
    "Limits", "Sequences", "Series", "Conic Sections", "Parametric Equations",
    "Polar Coordinates", "Complex Numbers", "Vectors",
    // Calculus
    "Derivatives", "Integrals", "Chain Rule", "Product Rule", "L'Hôpital's Rule",
    "Related Rates", "Optimization", "Area Under Curve", "Volumes of Revolution",
    "Taylor Series", "Partial Derivatives", "Multiple Integrals",
    // Linear Algebra
    "Matrices", "Determinants", "Eigenvalues", "Eigenvectors", "Vector Spaces",
    "Linear Transformations", "Dot Product", "Cross Product",
    // Statistics & Probability
    "Mean & Median", "Standard Deviation", "Normal Distribution", "Hypothesis Testing",
    "Regression", "Correlation", "Combinatorics", "Bayes' Theorem", "Confidence Intervals",
    // Advanced
    "Differential Equations", "Real Analysis", "Abstract Algebra", "Number Theory",
    "Topology", "Discrete Math", "Graph Theory", "Set Theory",
  ],
  physics: [
    // Fundamentals
    "Units & Measurement", "Significant Figures", "Dimensional Analysis",
    "Scalar & Vector", "Estimation",
    // Mechanics
    "Kinematics", "Free Fall", "Projectile Motion", "Newton's Laws",
    "Friction", "Inclined Planes", "Circular Motion", "Centripetal Force",
    "Torque", "Rotational Motion", "Angular Momentum",
    // Energy & Work
    "Work", "Kinetic Energy", "Potential Energy", "Conservation of Energy",
    "Power", "Elastic Collisions", "Inelastic Collisions", "Impulse",
    "Momentum", "Center of Mass",
    // Waves & Sound
    "Simple Harmonic Motion", "Pendulums", "Wave Properties", "Sound Waves",
    "Resonance", "Doppler Effect", "Standing Waves", "Interference",
    "Diffraction", "Superposition",
    // Thermodynamics
    "Temperature", "Heat Transfer", "Specific Heat", "Thermal Expansion",
    "First Law", "Second Law", "Entropy", "Carnot Cycle",
    "Ideal Gas Law", "Phase Changes",
    // Electricity & Magnetism
    "Coulomb's Law", "Electric Fields", "Electric Potential", "Capacitance",
    "Ohm's Law", "DC Circuits", "Kirchhoff's Laws", "RC Circuits",
    "Magnetic Fields", "Faraday's Law", "Inductance", "AC Circuits",
    "Electromagnetic Waves", "Maxwell's Equations",
    // Optics
    "Reflection", "Refraction", "Snell's Law", "Lenses", "Mirrors",
    "Polarization", "Thin Film Interference",
    // Modern Physics
    "Special Relativity", "Photoelectric Effect", "Quantum Mechanics",
    "Wave-Particle Duality", "Atomic Models", "Nuclear Physics",
    "Radioactive Decay", "Particle Physics", "Schrödinger Equation",
    // Astrophysics
    "Gravity", "Orbital Mechanics", "Kepler's Laws", "Black Holes",
    "Cosmology",
  ],
  chemistry: [
    // Fundamentals
    "Atoms", "Elements", "Compounds", "Mixtures", "States of Matter",
    "Physical vs Chemical", "Periodic Table", "Atomic Number", "Mass Number",
    // Atomic Structure
    "Electron Configuration", "Quantum Numbers", "Orbitals", "Isotopes",
    "Ions", "Atomic Radius", "Ionization Energy", "Electronegativity",
    "Periodic Trends",
    // Bonding
    "Ionic Bonds", "Covalent Bonds", "Metallic Bonds", "Lewis Structures",
    "VSEPR Theory", "Molecular Geometry", "Polarity", "Intermolecular Forces",
    "Hydrogen Bonds", "Van der Waals",
    // Reactions
    "Balancing Equations", "Types of Reactions", "Combustion", "Synthesis",
    "Decomposition", "Single Replacement", "Double Replacement",
    "Net Ionic Equations", "Precipitation",
    // Stoichiometry
    "Molar Mass", "Mole Conversions", "Limiting Reagent", "Percent Yield",
    "Empirical Formula", "Molecular Formula", "Avogadro's Number",
    // Solutions
    "Molarity", "Dilution", "Solubility", "Saturation", "Colligative Properties",
    "Osmotic Pressure",
    // Acids & Bases
    "pH Scale", "Strong Acids", "Weak Acids", "Buffers", "Titration",
    "Henderson-Hasselbalch", "Neutralization", "Indicators",
    // Thermochemistry
    "Enthalpy", "Hess's Law", "Calorimetry", "Bond Energy",
    "Endothermic", "Exothermic", "Entropy", "Gibbs Free Energy",
    // Kinetics & Equilibrium
    "Reaction Rate", "Rate Laws", "Activation Energy", "Catalysts",
    "Equilibrium Constants", "Le Chatelier's Principle", "ICE Tables",
    // Gas Laws
    "Boyle's Law", "Charles's Law", "Ideal Gas Law", "Dalton's Law",
    "Graham's Law", "Partial Pressure",
    // Electrochemistry & Advanced
    "Oxidation States", "Redox Reactions", "Galvanic Cells", "Electrolysis",
    "Cell Potential", "Organic Chemistry", "Functional Groups",
    "Polymerization", "Biochemistry", "Nuclear Chemistry",
  ],
  teacher: [
    "Auto-Grading", "Class Analytics", "Test Generator", "Student Progress",
    "Step-by-Step Help", "AI Tutoring", "Assignments", "Course Management",
    "Practice Sets", "Differentiation", "Real-Time Data", "Answer Keys",
    "Student Reports", "Curriculum Mapping", "Homework Review",
    "Rubric Builder", "Progress Tracking", "Intervention Alerts",
    "Parent Reports", "Lesson Planning", "Standards Alignment",
    "Formative Assessment", "Summative Assessment", "Question Banks",
    "Adaptive Learning", "Skill Mastery", "Learning Gaps",
    "Performance Trends", "Engagement Metrics", "Class Roster",
    "Section Management", "Grade Export", "Bulk Actions",
    "Custom Tests", "Variant Generation", "Difficulty Scaling",
    "Time Tracking", "Session Replay", "Error Analysis",
    "Concept Maps", "Prerequisite Chains",
  ],
};

interface ScrollingTopicsProps {
  subject?: "all" | "math" | "physics" | "chemistry" | "teacher";
}

export function ScrollingTopics({ subject = "all" }: ScrollingTopicsProps) {
  let leftItems: string[];
  let rightItems: string[];

  if (subject === "all") {
    // Main page: interleave subtopics from all subjects
    leftItems = [
      "Quadratics", "Kinematics", "Stoichiometry", "Derivatives", "Waves",
      "Molarity", "Trigonometry", "Circuits", "Acid & Bases", "Integrals",
      "Momentum", "Redox Reactions", "Linear Algebra", "Optics", "Gas Laws",
      "Probability", "Torque", "Lewis Structures", "Factoring", "Entropy",
      "Titration", "Vectors", "Free Fall", "Equilibrium", "Proofs",
      "Doppler Effect", "pH Scale", "Taylor Series", "Capacitance",
      "Hess's Law", "Eigenvalues", "Pendulums",
    ];
    rightItems = [
      "Polynomials", "Friction", "Bonding", "Chain Rule", "Sound Waves",
      "Percent Yield", "Unit Circle", "Electric Fields", "Buffers",
      "Limits", "Angular Momentum", "Organic Chemistry", "Matrices",
      "Refraction", "Boyle's Law", "Standard Deviation", "Centripetal Force",
      "Electrochemistry", "Slope", "Thermodynamics", "Calorimetry",
      "Complex Numbers", "Gravity", "Mole Conversions", "Geometry",
      "Faraday's Law", "Catalysts", "Differential Equations", "Relativity",
      "Functional Groups", "Bayes' Theorem", "Nuclear Physics",
    ];
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
