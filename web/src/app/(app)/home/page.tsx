"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import Link from "next/link";
import { Card } from "@/components/ui";
import { auth, student, type EnrolledCourse } from "@/lib/api";

const genericSubjects = [
  {
    id: "math",
    name: "Mathematics",
    description: "Algebra, equations, word problems, and more",
    gradient: "from-primary to-primary-light",
    modes: ["Learn", "Mock Test"],
  },
  {
    id: "physics",
    name: "Physics",
    description: "Mechanics, energy, waves, and more",
    gradient: "from-[#0984E3] to-[#74B9FF]",
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

const SUBJECT_GRADIENTS: Record<string, string> = {
  math: "from-primary to-primary-light",
  chemistry: "from-[#00B894] to-[#55EFC4]",
  physics: "from-[#0984E3] to-[#74B9FF]",
};

export default function HomePage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    document.documentElement.removeAttribute("data-subject");
  }, []);

  const loadEnrolledCourses = () => {
    auth
      .enrolledCourses()
      .then((d) => setEnrolledCourses(d.courses))
      .catch(() => {})
      .finally(() => setLoadingCourses(false));
  };

  useEffect(() => { loadEnrolledCourses(); }, []);

  async function handleJoinSection(e: React.FormEvent) {
    e.preventDefault();
    setJoining(true);
    setJoinError("");
    try {
      await student.joinSection(joinCode.trim());
      setJoinCode("");
      loadEnrolledCourses();
    } catch (err) {
      setJoinError((err as Error).message || "Invalid code");
    } finally {
      setJoining(false);
    }
  }

  const isSchoolStudent = enrolledCourses.length > 0;

  return (
    <div className="space-y-10">
      {/* Greeting */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-extrabold tracking-tight text-text-primary">
          Hi, {user?.name?.split(" ")[0]}!
        </h1>
        <p className="mt-1 text-text-secondary">
          {isSchoolStudent ? "Here are your classes" : "Ready to learn something new?"}
        </p>

        {/* Join class code — students only */}
        {user?.role !== "teacher" && <form onSubmit={handleJoinSection} className="mt-4 flex items-center gap-2">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError(""); }}
            placeholder="Enter class code"
            maxLength={6}
            className="w-36 rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm font-mono font-semibold tracking-widest text-text-primary outline-none placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-text-muted focus:border-primary"
          />
          <button
            type="submit"
            disabled={joinCode.trim().length < 4 || joining}
            className="rounded-[--radius-sm] bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            {joining ? "Joining..." : "Join"}
          </button>
          {joinError && <span className="text-xs text-red-500">{joinError}</span>}
        </form>}
      </motion.div>

      {/* School student — enrolled courses */}
      {isSchoolStudent && (
        <div className="grid gap-6 sm:grid-cols-2">
          {enrolledCourses.map((course, i) => {
            const gradient = SUBJECT_GRADIENTS[course.subject] || SUBJECT_GRADIENTS.math;
            return (
              <motion.div
                key={`${course.id}-${course.section_id}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * i }}
              >
                <Card
                  variant="interactive"
                  className="relative overflow-hidden"
                  onClick={() => router.push(`/learn?subject=${course.subject}&section=${course.section_id}`)}
                >
                  <div className={`absolute left-0 top-0 h-1 w-full bg-gradient-to-r ${gradient}`} />
                  <div className="flex items-start gap-4 pt-2">
                    <div
                      className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[--radius-md] bg-gradient-to-br ${gradient} text-white shadow-sm`}
                    >
                      {course.subject === "physics" ? <PhysicsIcon /> : course.subject === "chemistry" ? <ChemIcon /> : <MathIcon />}
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-text-primary">{course.name}</h2>
                      <p className="mt-0.5 text-sm text-text-secondary">
                        {course.teacher_name} · {course.section_name}
                      </p>
                      <div className="mt-3 flex gap-2">
                        {["Learn", "Practice", "Mock Test"].map((mode) => (
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
            );
          })}
        </div>
      )}

      {/* Regular student — generic subjects */}
      {!isSchoolStudent && !loadingCourses && (
        <div className="grid gap-6 sm:grid-cols-3">
          {genericSubjects.map((subject, i) => (
            <motion.div
              key={subject.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 * i }}
            >
              <Card
                variant="interactive"
                className="relative overflow-hidden"
                onClick={() => router.push(`/learn?subject=${subject.id}`)}
              >
                <div className={`absolute left-0 top-0 h-1 w-full bg-gradient-to-r ${subject.gradient}`} />
                <div className="flex items-start gap-4 pt-2">
                  <div
                    className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[--radius-md] bg-gradient-to-br ${subject.gradient} text-white shadow-sm`}
                  >
                    {subject.id === "math" ? <MathIcon /> : subject.id === "physics" ? <PhysicsIcon /> : <ChemIcon />}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-text-primary">{subject.name}</h2>
                    <p className="mt-0.5 text-sm text-text-secondary">{subject.description}</p>
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
      )}

      {/* Loading state */}
      {loadingCourses && (
        <div className="py-8 text-center text-text-muted">Loading...</div>
      )}

      {/* Upgrade CTA for free regular students only */}
      {user && !user.is_pro && !isSchoolStudent && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Link
            href="/pricing"
            className="flex items-center justify-between rounded-[--radius-xl] border border-primary/20 bg-primary-bg/50 p-5 transition-colors hover:bg-primary-bg"
          >
            <div>
              <p className="font-bold text-text-primary">Upgrade to Pro</p>
              <p className="mt-0.5 text-sm text-text-secondary">
                Unlimited sessions, mock exams, work diagnosis, and more
              </p>
            </div>
            <span className="shrink-0 rounded-[--radius-pill] bg-primary px-4 py-2 text-xs font-bold text-white">
              View Plans
            </span>
          </Link>
        </motion.div>
      )}
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

function PhysicsIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}
