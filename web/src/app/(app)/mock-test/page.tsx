"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore } from "@/stores/session";
import { Button, Card, Badge, useToast } from "@/components/ui";
import { Input } from "@/components/ui/input";
import { SkeletonStep } from "@/components/ui/skeleton";
import { useConfetti } from "@/components/ui/confetti";
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
    startLearnQueue,
    reset,
  } = useSessionStore();

  const toast = useToast();
  const { fire: fireConfetti } = useConfetti();
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

  useEffect(() => {
    if (phase === "error" && error) toast.error(error);
  }, [phase, error, toast]);

  // Confetti on good mock test score (>=70%)
  useEffect(() => {
    if (phase === "mock_test_summary" && mockTest?.results) {
      const correct = mockTest.results.filter((r) => r.isCorrect === true).length;
      const score = Math.round((correct / mockTest.results.length) * 100);
      if (score >= 70) fireConfetti(score === 100);
    }
  }, [phase, mockTest, fireConfetti]);

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
    const unanswered = mockTest.results.length - answered;
    const score = answered > 0 ? Math.round((correct / mockTest.results.length) * 100) : 0;
    const timeTaken = mockTest.submittedAt && mockTest.startedAt
      ? Math.floor((mockTest.submittedAt - mockTest.startedAt) / 1000)
      : null;
    const flaggedQuestions = mockTest.results
      .map((r, i) => ({ question: r.question, index: i }))
      .filter((_, i) => mockTest.flags[i]);
    const getMessage = () => {
      if (score >= 90) return "Excellent work!";
      if (score >= 70) return "Good job!";
      if (score >= 50) return "Keep practicing!";
      return "Don't give up — review and try again!";
    };
    const formatTimeTaken = (seconds: number) => {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}m ${s}s`;
    };

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Score card */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card variant="elevated" className="text-center space-y-3">
            <p className="text-sm font-semibold text-text-muted">Exam Results</p>
            <p className="text-4xl font-extrabold text-primary">{correct}/{mockTest.results.length}</p>

            <div className="mx-auto h-2 w-48 overflow-hidden rounded-full bg-border-light">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
                style={{ width: `${score}%` }}
              />
            </div>
            <p className="text-lg font-bold text-text-primary">{score}%</p>
            <p className="text-sm text-text-secondary">{getMessage()}</p>

            {timeTaken != null && (
              <p className="text-xs text-text-muted">
                Completed in {formatTimeTaken(timeTaken)}
              </p>
            )}

            <div className="flex justify-center gap-4 pt-2">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-success" />
                <span className="text-xs text-text-secondary">{correct} correct</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-error" />
                <span className="text-xs text-text-secondary">{answered - correct} wrong</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-text-muted" />
                <span className="text-xs text-text-secondary">{unanswered} skipped</span>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Question breakdown */}
        <h2 className="text-sm font-semibold text-text-muted">Question Breakdown</h2>
        <div className="space-y-2">
          {mockTest.results.map((r, i) => (
            <Card key={i} variant="flat" className="space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                    r.isCorrect === true ? "bg-success" : r.isCorrect === false ? "bg-error" : "bg-text-muted",
                  )}
                >
                  {r.isCorrect === true ? "\u2713" : r.isCorrect === false ? "\u2717" : "\u2013"}
                </span>
                <span className="text-xs font-bold text-text-muted">Q{i + 1}</span>
                <button
                  onClick={() => toggleMockTestFlag(i)}
                  className={cn(
                    "ml-auto rounded-[--radius-pill] border px-3 py-0.5 text-xs font-semibold transition-colors",
                    mockTest.flags[i]
                      ? "border-warning-dark/30 bg-warning-bg text-warning-dark"
                      : "border-border text-text-muted hover:border-warning-dark/30 hover:text-warning-dark",
                  )}
                >
                  {mockTest.flags[i] ? "Flagged" : "Flag"}
                </button>
              </div>
              <p className="text-sm font-medium text-text-primary">{r.question}</p>
              {r.isCorrect === true && (
                <div>
                  <p className="text-xs text-text-secondary">Your answer: {r.userAnswer}</p>
                  <p className="text-xs font-medium text-success">Correct!</p>
                </div>
              )}
              {r.isCorrect === false && (
                <div>
                  <p className="text-xs text-error">Your answer: {r.userAnswer}</p>
                  <p className="text-xs text-text-muted italic">Flag this question and learn it to see the answer</p>
                </div>
              )}
              {r.isCorrect == null && (
                <div>
                  <p className="text-xs text-text-muted">Unanswered</p>
                  <p className="text-xs text-text-muted italic">Flag this question and learn it to see the answer</p>
                </div>
              )}
            </Card>
          ))}
        </div>

        {/* Flagged questions */}
        {flaggedQuestions.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-text-muted">
              Flagged Questions ({flaggedQuestions.length})
            </h2>
            <Button
              gradient
              onClick={async () => {
                const problems = flaggedQuestions.map((q) => q.question);
                await startLearnQueue(problems);
                router.push("/learn/session");
              }}
              className="w-full"
            >
              Learn These
            </Button>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={() => { reset(); router.push("/learn"); }} className="w-full">
            New Exam
          </Button>
          <Button variant="secondary" onClick={() => { reset(); router.push("/home"); }} className="w-full">
            Return Home
          </Button>
        </div>
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
