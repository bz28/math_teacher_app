"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import { Card } from "@/components/ui";

const subjects = [
  {
    id: "math",
    name: "Mathematics",
    description: "Algebra, equations, word problems, and more",
    gradient: "from-primary to-primary-light",
    modes: ["Learn", "Mock Test"],
  },
  {
    id: "chemistry",
    name: "Chemistry",
    description: "Reactions, balancing equations, stoichiometry, and more",
    gradient: "from-[#00B894] to-[#55EFC4]",
    modes: ["Learn", "Mock Test"],
  },
];

export default function HomePage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  return (
    <div className="space-y-10">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-extrabold tracking-tight text-text-primary">
          Hi, {user?.name?.split(" ")[0]}!
        </h1>
        <p className="mt-1 text-text-secondary">
          Ready to learn something new?
        </p>
      </motion.div>

      {/* Subject cards */}
      <div className="grid gap-6 sm:grid-cols-2">
        {subjects.map((subject, i) => (
          <motion.div
            key={subject.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 * i }}
          >
            <Card
              variant="interactive"
              className="relative overflow-hidden"
              onClick={() =>
                router.push(`/learn?subject=${subject.id}`)
              }
            >
              {/* Gradient accent */}
              <div
                className={`absolute left-0 top-0 h-1 w-full bg-gradient-to-r ${subject.gradient}`}
              />

              <div className="flex items-start gap-4 pt-2">
                {/* Icon */}
                <div
                  className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[--radius-md] bg-gradient-to-br ${subject.gradient} text-white shadow-sm`}
                >
                  {subject.id === "math" ? (
                    <MathIcon />
                  ) : (
                    <ChemIcon />
                  )}
                </div>

                <div>
                  <h2 className="text-lg font-bold text-text-primary">
                    {subject.name}
                  </h2>
                  <p className="mt-0.5 text-sm text-text-secondary">
                    {subject.description}
                  </p>
                  <div className="mt-3 flex gap-2">
                    {subject.modes.map((mode) => (
                      <span
                        key={mode}
                        className="rounded-[--radius-pill] bg-primary-bg px-3 py-1 text-xs font-semibold text-primary"
                      >
                        {mode}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function MathIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
    </svg>
  );
}

function ChemIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6v7l4 9H5l4-9V3z" />
      <line x1="9" y1="3" x2="15" y2="3" />
    </svg>
  );
}
