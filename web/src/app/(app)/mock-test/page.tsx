"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore } from "@/stores/session";
import { Button, Card, Badge } from "@/components/ui";
import { Input } from "@/components/ui/input";
import { SkeletonStep } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function MockTestPage() {
  const router = useRouter();
  const {
    mockTest,
    phase,
    error,
    saveMockTestAnswer,
    toggleMockTestFlag,
    setMockTestIndex,
    submitMockTest,
    reset,
  } = useSessionStore();

  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Timer
  useEffect(() => {
    if (!mockTest?.timeLimitSeconds || phase !== "mock_test_active") return;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - mockTest.startedAt) / 1000);
      const remaining = mockTest.timeLimitSeconds! - elapsed;
      setTimeLeft(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(interval);
        submitMockTest();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [mockTest, phase, submitMockTest]);

  useEffect(() => {
    if (phase === "idle" && !mockTest) {
      router.replace("/learn");
    }
  }, [phase, mockTest, router]);

  if (phase === "loading" || !mockTest) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <SkeletonStep />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="mx-auto max-w-2xl text-center space-y-4 py-12">
        <p className="text-error font-medium">{error}</p>
        <Button variant="secondary" onClick={() => router.push("/learn")}>
          Try Again
        </Button>
      </div>
    );
  }

  // Results
  if (phase === "mock_test_summary" && mockTest.results) {
    const correct = mockTest.results.filter((r) => r.isCorrect === true).length;
    const answered = mockTest.results.filter((r) => r.userAnswer !== null).length;

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-extrabold text-text-primary">
            Mock Test Results
          </h1>
          <div className="mt-2 flex gap-4">
            <div className="rounded-[--radius-md] bg-success-light px-4 py-2 text-center">
              <p className="text-2xl font-extrabold text-success">{correct}</p>
              <p className="text-xs text-text-secondary">Correct</p>
            </div>
            <div className="rounded-[--radius-md] bg-error-light px-4 py-2 text-center">
              <p className="text-2xl font-extrabold text-error">
                {answered - correct}
              </p>
              <p className="text-xs text-text-secondary">Incorrect</p>
            </div>
            <div className="rounded-[--radius-md] bg-warning-bg px-4 py-2 text-center">
              <p className="text-2xl font-extrabold text-warning-dark">
                {mockTest.results.length - answered}
              </p>
              <p className="text-xs text-text-secondary">Skipped</p>
            </div>
          </div>
        </motion.div>

        <div className="space-y-3">
          {mockTest.results.map((r, i) => (
            <Card key={i} variant="flat" className="space-y-2">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                    r.isCorrect === true
                      ? "bg-success"
                      : r.isCorrect === false
                        ? "bg-error"
                        : "bg-text-muted",
                  )}
                >
                  {i + 1}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">
                    {r.question}
                  </p>
                  {r.userAnswer && (
                    <p className="mt-1 text-xs text-text-secondary">
                      Your answer: {r.userAnswer}
                    </p>
                  )}
                  <p className="text-xs text-success">
                    Correct: {r.correctAnswer}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Button
          variant="secondary"
          onClick={() => {
            reset();
            router.push("/home");
          }}
        >
          Done
        </Button>
      </div>
    );
  }

  // Active exam
  const current = mockTest.questions[mockTest.currentIndex];
  const currentAnswer = mockTest.answers[mockTest.currentIndex] ?? "";
  const isFlagged = mockTest.flags[mockTest.currentIndex];

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header with timer */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Mock Test</h1>
        <div className="flex items-center gap-3">
          {timeLeft !== null && (
            <span
              className={cn(
                "text-sm font-mono font-bold",
                timeLeft <= 60 ? "text-error" : "text-text-secondary",
              )}
            >
              {formatTime(timeLeft)}
            </span>
          )}
          <Button
            variant="danger"
            size="sm"
            onClick={submitMockTest}
          >
            Submit Test
          </Button>
        </div>
      </div>

      {/* Question navigator */}
      <div className="flex flex-wrap gap-2">
        {mockTest.questions.map((_, i) => (
          <button
            key={i}
            onClick={() => setMockTestIndex(i)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-[--radius-sm] text-xs font-bold transition-colors",
              i === mockTest.currentIndex
                ? "bg-primary text-white"
                : mockTest.answers[i]
                  ? "bg-success-light text-success border border-success-border"
                  : "bg-input-bg text-text-muted border border-border",
              mockTest.flags[i] && "ring-2 ring-warning",
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Current question */}
      <Card variant="elevated" className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <Badge variant="info">
              Question {mockTest.currentIndex + 1} of{" "}
              {mockTest.questions.length}
            </Badge>
            <p className="mt-3 text-base font-medium text-text-primary">
              {current.question}
            </p>
          </div>
          <button
            onClick={() => toggleMockTestFlag(mockTest.currentIndex)}
            className={cn(
              "rounded-[--radius-sm] p-2 transition-colors",
              isFlagged
                ? "bg-warning-bg text-warning-dark"
                : "text-text-muted hover:bg-warning-bg hover:text-warning-dark",
            )}
            title={isFlagged ? "Unflag" : "Flag for review"}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill={isFlagged ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
          </button>
        </div>

        <Input
          placeholder="Your answer..."
          value={currentAnswer}
          onChange={(e) =>
            saveMockTestAnswer(mockTest.currentIndex, e.target.value)
          }
        />

        <div className="flex justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMockTestIndex(Math.max(0, mockTest.currentIndex - 1))}
            disabled={mockTest.currentIndex === 0}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setMockTestIndex(
                Math.min(
                  mockTest.questions.length - 1,
                  mockTest.currentIndex + 1,
                ),
              )
            }
            disabled={mockTest.currentIndex === mockTest.questions.length - 1}
          >
            Next
          </Button>
        </div>
      </Card>
    </div>
  );
}
