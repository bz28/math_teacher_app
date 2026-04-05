"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

/* ================================================================
   AnimatedLearnDemo — auto-plays through a step-by-step session
   ================================================================ */

const LEARN_STEPS = [
  {
    num: 1,
    title: "Understand the Problem",
    content:
      'We have a quadratic equation 2x² + 5x − 3 = 0 and need to find the values of x. Since the highest power is x², we expect two solutions.',
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
      "x = (−b ± √(b² − 4ac)) / 2a. Substituting: x = (−5 ± √(25 + 24)) / 4 = (−5 ± 7) / 4.",
  },
  {
    num: 4,
    title: "Calculate Both Solutions",
    content: "x₁ = (−5 + 7) / 4 = 1/2 and x₂ = (−5 − 7) / 4 = −3. Both solutions satisfy the original equation.",
  },
];

const LEARN_CYCLE_MS = 3000;

export function AnimatedLearnDemo() {
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleCount((prev) => {
        if (prev >= LEARN_STEPS.length) {
          // Reset after a pause
          setTimeout(() => setVisibleCount(1), 800);
          return prev;
        }
        return prev + 1;
      });
    }, LEARN_CYCLE_MS);
    return () => clearInterval(interval);
  }, []);

  const progress = (visibleCount / LEARN_STEPS.length) * 100;

  return (
    <div className="space-y-3.5">
      {/* Problem */}
      <div>
        <p className="text-[10px] font-medium text-text-muted">Problem</p>
        <p className="mt-0.5 text-sm font-semibold leading-snug text-text-primary">
          Solve for x: 2x² + 5x − 3 = 0
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
          Step {Math.min(visibleCount, LEARN_STEPS.length)} of {LEARN_STEPS.length}
        </p>
      </div>

      {/* Steps appearing one by one */}
      <div className="space-y-2.5">
        <AnimatePresence mode="popLayout">
          {LEARN_STEPS.slice(0, visibleCount).map((step, i) => {
            const isActive = i === visibleCount - 1;
            const isCompleted = i < visibleCount - 1;

            return (
              <motion.div
                key={step.num}
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
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.6, delay: 0.15 }}
                      className="mt-1 text-[11px] leading-relaxed text-text-primary"
                    >
                      {step.content}
                    </motion.p>
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
            visibleCount < LEARN_STEPS.length
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
  );
}

/* ================================================================
   AnimatedChatDemo — auto-plays a tutor conversation
   ================================================================ */

const CHAT_MESSAGES = [
  {
    role: "context" as const,
    content: "Balance the chemical equation: Fe + O₂ → Fe₂O₃",
  },
  {
    role: "user" as const,
    content: "What does \"balancing\" actually mean?",
  },
  {
    role: "tutor" as const,
    content:
      "Balancing means making sure the same number of each type of atom appears on both sides of the arrow. Atoms can't be created or destroyed — so if you start with 2 iron atoms, you must end with 2.",
  },
  {
    role: "user" as const,
    content: "So I just need to count the atoms on each side?",
  },
  {
    role: "tutor" as const,
    content:
      "Exactly! Start by counting Fe and O on each side. Right now the left has 1 Fe and 2 O, while the right has 2 Fe and 3 O. We need coefficients to make them match.",
  },
];

const CHAT_CYCLE_MS = 2500;

export function AnimatedChatDemo() {
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleCount((prev) => {
        if (prev >= CHAT_MESSAGES.length) {
          setTimeout(() => setVisibleCount(1), 1000);
          return prev;
        }
        return prev + 1;
      });
    }, CHAT_CYCLE_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-3">
      {/* Step context — always visible */}
      <div className="rounded-[--radius-md] border border-primary/20 bg-primary-bg/20 p-3 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-light text-[10px] font-bold text-white">
            2
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-primary">Balance the Equation</p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-primary">
              {CHAT_MESSAGES[0].content}. Start with the most complex molecule and work outward.
            </p>
          </div>
        </div>
      </div>

      {/* Chat messages appearing one by one */}
      <AnimatePresence mode="popLayout">
        {CHAT_MESSAGES.slice(1, visibleCount).map((msg, i) => (
          <motion.div
            key={i}
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
        {visibleCount < CHAT_MESSAGES.length && visibleCount > 1 && (
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
  );
}
