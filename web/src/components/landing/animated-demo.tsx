"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

/* ================================================================
   Subject-specific learn demo data
   ================================================================ */

interface LearnStep {
  num: number;
  title: string;
  content: string;
  formula?: string;
}

interface LearnScenario {
  problem: string;
  steps: LearnStep[];
}

const LEARN_SCENARIOS: Record<string, LearnScenario> = {
  math: {
    problem: "Solve for x: 2x² + 5x − 3 = 0",
    steps: [
      {
        num: 1,
        title: "Understand the Problem",
        content:
          "We have a quadratic equation and need to find the values of x. Since the highest power is x², we expect two solutions. The quadratic formula is the most direct approach.",
      },
      {
        num: 2,
        title: "Identify Coefficients",
        content:
          "In the standard form ax² + bx + c = 0 we identify: a = 2, b = 5, c = −3. These go into the quadratic formula.",
      },
      {
        num: 3,
        title: "Apply the Quadratic Formula",
        content:
          "Substituting our coefficients into the formula and simplifying the discriminant:",
        formula: "x = (−b ± √(b² − 4ac)) / 2a",
      },
      {
        num: 4,
        title: "Calculate Both Solutions",
        content:
          "x = (−5 ± √(25 + 24)) / 4 = (−5 ± 7) / 4. So x₁ = ½ and x₂ = −3. Both satisfy the original equation.",
      },
    ],
  },
  physics: {
    problem: "A 2 kg ball is dropped from 10 m. Find its velocity just before hitting the ground. (g = 9.8 m/s²)",
    steps: [
      {
        num: 1,
        title: "Understand the Problem",
        content:
          "We have a ball in free fall from rest. We know the initial velocity (v₀ = 0), displacement (h = 10 m), and acceleration (g = 9.8 m/s²). We need the final velocity.",
      },
      {
        num: 2,
        title: "Choose the Right Equation",
        content:
          "For free fall with known displacement and acceleration, the most direct kinematic equation is:",
        formula: "v² = v₀² + 2gh",
      },
      {
        num: 3,
        title: "Substitute Values",
        content:
          "Since v₀ = 0 (starts from rest): v² = 0 + 2(9.8)(10) = 196. Taking the square root: v = √196 = 14 m/s.",
      },
      {
        num: 4,
        title: "Verify the Answer",
        content:
          "The velocity is 14 m/s downward just before impact. This is independent of mass — a heavier ball would have the same speed. The answer is reasonable for a 10 m drop.",
      },
    ],
  },
  chemistry: {
    problem: "How many grams of CO₂ are produced from burning 16 g of CH₄?",
    steps: [
      {
        num: 1,
        title: "Write the Balanced Equation",
        content:
          "The combustion of methane is:",
        formula: "CH₄ + 2O₂ → CO₂ + 2H₂O",
      },
      {
        num: 2,
        title: "Find Moles of CH₄",
        content:
          "Molar mass of CH₄ = 12 + 4(1) = 16 g/mol. So 16 g of CH₄ = 16/16 = 1 mol of CH₄.",
      },
      {
        num: 3,
        title: "Apply the Mole Ratio",
        content:
          "From the balanced equation, 1 mol CH₄ produces 1 mol CO₂. So we get 1 mol of CO₂.",
      },
      {
        num: 4,
        title: "Convert to Grams",
        content:
          "Molar mass of CO₂ = 12 + 2(16) = 44 g/mol. So 1 mol CO₂ = 44 grams. Burning 16 g of methane produces 44 g of CO₂.",
      },
    ],
  },
};

const DEFAULT_SCENARIO = LEARN_SCENARIOS.math;

/* ================================================================
   Subject-specific chat demo data
   ================================================================ */

interface ChatMessage {
  role: "context" | "user" | "tutor";
  content: string;
}

interface ChatScenario {
  stepTitle: string;
  contextContent: string;
  messages: ChatMessage[];
}

const CHAT_SCENARIOS: Record<string, ChatScenario> = {
  math: {
    stepTitle: "Apply the Quadratic Formula",
    contextContent: "Use the quadratic formula to solve 2x² + 5x − 3 = 0. Identify a, b, and c, then substitute.",
    messages: [
      { role: "user", content: "Why can't I just factor this instead?" },
      {
        role: "tutor",
        content:
          "You can try! But 2x² + 5x − 3 doesn't factor into nice integers easily. The quadratic formula works for every quadratic — it's the reliable fallback when factoring isn't obvious.",
      },
      { role: "user", content: "How do I know when factoring won't work?" },
      {
        role: "tutor",
        content:
          "Check the discriminant b² − 4ac. If it's a perfect square, factoring is possible. Here it's 25 + 24 = 49, which is 7². So factoring does work — but the formula is faster when you're unsure.",
      },
    ],
  },
  physics: {
    stepTitle: "Choose the Right Equation",
    contextContent: "Select the kinematic equation that relates initial velocity, displacement, acceleration, and final velocity.",
    messages: [
      { role: "user", content: "Why not use v = v₀ + gt instead?" },
      {
        role: "tutor",
        content:
          "That equation gives velocity as a function of time — but we don't know the time! We know the height (10 m), so v² = v₀² + 2gh is the direct path since it skips the time variable entirely.",
      },
      { role: "user", content: "Does the mass of the ball matter here?" },
      {
        role: "tutor",
        content:
          "Great question — no! In free fall (ignoring air resistance), all objects accelerate at g regardless of mass. Galileo demonstrated this famously. The 2 kg is a red herring in this problem.",
      },
    ],
  },
  chemistry: {
    stepTitle: "Apply the Mole Ratio",
    contextContent: "Use the balanced equation CH₄ + 2O₂ → CO₂ + 2H₂O to find how many moles of CO₂ are produced.",
    messages: [
      { role: "user", content: "What does \"mole ratio\" actually mean?" },
      {
        role: "tutor",
        content:
          "The coefficients in a balanced equation tell you the ratio of molecules that react. 1 CH₄ reacts with 2 O₂ to produce 1 CO₂ and 2 H₂O. So 1 mole of methane always gives exactly 1 mole of CO₂.",
      },
      { role: "user", content: "What if I started with 32 g of CH₄ instead?" },
      {
        role: "tutor",
        content:
          "Then you'd have 2 moles of CH₄ (32 ÷ 16), which produces 2 moles of CO₂ = 88 g. The ratio stays the same — you just scale everything up proportionally.",
      },
    ],
  },
};

const DEFAULT_CHAT = CHAT_SCENARIOS.math;

/* ================================================================
   AnimatedLearnDemo — auto-plays through a step-by-step session
   ================================================================ */

const LEARN_CYCLE_MS = 3000;

export function AnimatedLearnDemo({ subject }: { subject?: string }) {
  const scenario = (subject && LEARN_SCENARIOS[subject.toLowerCase()]) || DEFAULT_SCENARIO;
  const steps = scenario.steps;
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    setVisibleCount(1);
  }, [subject]);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleCount((prev) => {
        if (prev >= steps.length) {
          setTimeout(() => setVisibleCount(1), 800);
          return prev;
        }
        return prev + 1;
      });
    }, LEARN_CYCLE_MS);
    return () => clearInterval(interval);
  }, [steps.length]);

  const progress = (visibleCount / steps.length) * 100;

  return (
    <div className="h-[380px] overflow-hidden">
      <div className="space-y-3.5">
        {/* Problem */}
        <div>
          <p className="text-[10px] font-medium text-text-muted">Problem</p>
          <p className="mt-0.5 text-sm font-semibold leading-snug text-text-primary">
            {scenario.problem}
          </p>
        </div>

        {/* Animated progress bar */}
        <div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-light">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
          <p className="mt-1 text-[10px] text-text-muted">
            Step {Math.min(visibleCount, steps.length)} of {steps.length}
          </p>
        </div>

        {/* Steps appearing one by one */}
        <div className="space-y-2.5">
          <AnimatePresence mode="popLayout">
            {steps.slice(0, visibleCount).map((step, i) => {
              const isActive = i === visibleCount - 1;
              const isCompleted = i < visibleCount - 1;

              return (
                <motion.div
                  key={`${subject}-${step.num}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className={`rounded-[--radius-md] p-3 ${
                    isActive
                      ? "border border-primary/20 bg-primary-bg/20 shadow-sm"
                      : "border border-border-light bg-card/50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {isCompleted ? (
                      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-success">
                        <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    ) : (
                      <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-light text-[9px] font-bold text-white">
                        {step.num}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className={`text-[10px] font-semibold ${isCompleted ? "text-success" : "text-primary"}`}>
                        Step {step.num} — {step.title}
                      </p>
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.6, delay: 0.15 }}
                      >
                        <p className="mt-1 text-[11px] leading-relaxed text-text-primary">
                          {step.content}
                        </p>
                        {step.formula && (
                          <p className="my-1.5 text-center text-xs font-medium italic text-text-primary">
                            {step.formula}
                          </p>
                        )}
                      </motion.div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Input area */}
        <div className="flex gap-2">
          <div className="flex-1 rounded-[--radius-md] border border-border bg-input-bg px-3 py-1.5 text-[10px] text-text-muted">
            Ask a question...
          </div>
          <motion.div
            animate={
              visibleCount < steps.length
                ? { scale: [1, 1.04, 1] }
                : {}
            }
            transition={{ duration: 1.5, repeat: Infinity }}
            className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-[10px] font-bold text-white"
          >
            I Understand
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   AnimatedChatDemo — auto-plays a tutor conversation
   ================================================================ */

const CHAT_CYCLE_MS = 2500;

export function AnimatedChatDemo({ subject }: { subject?: string }) {
  const scenario = (subject && CHAT_SCENARIOS[subject.toLowerCase()]) || DEFAULT_CHAT;
  const messages = scenario.messages;
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    setVisibleCount(0);
  }, [subject]);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleCount((prev) => {
        if (prev >= messages.length) {
          setTimeout(() => setVisibleCount(0), 1000);
          return prev;
        }
        return prev + 1;
      });
    }, CHAT_CYCLE_MS);
    return () => clearInterval(interval);
  }, [messages.length]);

  return (
    <div className="h-[340px] overflow-hidden">
      <div className="space-y-3">
        {/* Step context — always visible */}
        <div className="rounded-[--radius-md] border border-primary/20 bg-primary-bg/20 p-3 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-light text-[10px] font-bold text-white">
              2
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-primary">{scenario.stepTitle}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-text-primary">
                {scenario.contextContent}
              </p>
            </div>
          </div>
        </div>

        {/* Chat messages appearing one by one */}
        <AnimatePresence mode="popLayout">
          {messages.slice(0, visibleCount).map((msg, i) => (
            <motion.div
              key={`${subject}-chat-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            >
              {msg.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-[--radius-md] bg-primary-bg px-3 py-2 text-xs text-primary">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div className="rounded-[--radius-md] border border-primary/15 bg-card p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-primary">Tutor</p>
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.5, delay: 0.1 }}
                        className="mt-0.5 text-xs leading-relaxed text-text-primary"
                      >
                        {msg.content}
                      </motion.p>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator when next message is about to appear */}
        <AnimatePresence>
          {visibleCount < messages.length && visibleCount > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 px-1"
            >
              <div className="flex gap-0.5">
                {[0, 1, 2].map((dot) => (
                  <motion.div
                    key={dot}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      delay: dot * 0.2,
                    }}
                    className="h-1.5 w-1.5 rounded-full bg-text-muted"
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input */}
        <div className="flex gap-2">
          <div className="flex-1 rounded-[--radius-md] border border-border bg-input-bg px-3 py-1.5 text-[10px] text-text-muted">
            Ask a question...
          </div>
          <div className="rounded-[--radius-md] bg-border px-3 py-1.5 text-[10px] font-semibold text-text-secondary">
            I Understand
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   AnimatedGradingDemo — auto-plays step-by-step grading
   ================================================================ */

const GRADING_STEPS = [
  { label: "Identified the problem type", correct: true },
  { label: "Set up the equation correctly", correct: true },
  { label: "Applied the formula", correct: true },
  { label: "Arithmetic in final step", correct: false, note: "Sign error: should be −3, not 3" },
];

const GRADE_CYCLE_MS = 1800;

export function AnimatedGradingDemo() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [showGrade, setShowGrade] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleCount((prev) => {
        if (prev >= GRADING_STEPS.length) {
          if (!showGrade) {
            setShowGrade(true);
          } else {
            // Reset
            setShowGrade(false);
            return 0;
          }
          return prev;
        }
        return prev + 1;
      });
    }, GRADE_CYCLE_MS);
    return () => clearInterval(interval);
  }, [showGrade]);

  const correctCount = GRADING_STEPS.filter((s) => s.correct).length;

  return (
    <div className="h-[320px] overflow-hidden">
      <div className="space-y-3.5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-medium text-text-muted">Student Submission</p>
            <p className="mt-0.5 text-sm font-semibold text-text-primary">
              Solve: 2x² + 5x − 3 = 0
            </p>
          </div>
          <div className="rounded-[--radius-sm] bg-primary-bg px-2.5 py-1 text-[10px] font-semibold text-primary">
            Auto-Grading
          </div>
        </div>

        {/* Grading steps */}
        <div className="space-y-2">
          {GRADING_STEPS.map((step, i) => {
            const isVisible = i < visibleCount;
            return (
              <div
                key={i}
                className={`flex items-start gap-3 rounded-[--radius-md] border p-2.5 transition-all duration-300 ${
                  !isVisible
                    ? "border-border-light bg-card/30 opacity-50"
                    : step.correct
                      ? "border-success/30 bg-success-light"
                      : "border-error/30 bg-error-light"
                }`}
              >
                <AnimatePresence>
                  {isVisible ? (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 400, damping: 15 }}
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                        step.correct ? "bg-success" : "bg-error"
                      }`}
                    >
                      {step.correct ? (
                        <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      )}
                    </motion.div>
                  ) : (
                    <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-border-light">
                      <div className="h-1.5 w-1.5 rounded-full bg-text-muted" />
                    </div>
                  )}
                </AnimatePresence>
                <div className="min-w-0">
                  <p className={`text-[11px] font-medium ${isVisible ? "text-text-primary" : "text-text-muted"}`}>
                    Step {i + 1}: {step.label}
                  </p>
                  {isVisible && !step.correct && step.note && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="mt-0.5 text-[10px] text-error"
                    >
                      {step.note}
                    </motion.p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Final grade */}
        <AnimatePresence>
          {showGrade && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-between rounded-[--radius-md] border border-primary/20 bg-primary-bg/30 p-3"
            >
              <div>
                <p className="text-[10px] font-medium text-text-muted">Auto-Grade Result</p>
                <p className="text-sm font-bold text-text-primary">
                  {correctCount}/{GRADING_STEPS.length} steps correct
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-light text-sm font-bold text-white">
                {Math.round((correctCount / GRADING_STEPS.length) * 100)}%
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
