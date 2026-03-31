"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore } from "@/stores/learn";
import { useMockTestStore } from "@/stores/mock-test";
import { Button, Card, Badge, useToast, AnimatedCounter } from "@/components/ui";
import { Input } from "@/components/ui/input";
import { SkeletonStep } from "@/components/ui/skeleton";
import { useConfetti } from "@/components/ui/confetti";
import { AttachWork } from "@/components/ui/attach-work";
import { DiagnosisTeaser } from "@/components/ui/diagnosis-teaser";
import { FlagIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export default function MockTestPage() {
  const router = useRouter();
  const { startLearnQueue, subject } = useSessionStore();
  const {
    mockTest,
    phase,
    error,
    saveMockTestAnswer,
    toggleMockTestFlag,
    setMockTestIndex,
    attachMockTestWork,
    submitMockTest,
    reset,
  } = useMockTestStore();

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
        submitMockTest(subject);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [mockTest, phase, submitMockTest, subject]);

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

  // Keyboard shortcuts for mock test navigation
  useEffect(() => {
    if (phase !== "mock_test_active" || !mockTest) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setMockTestIndex(Math.max(0, mockTest!.currentIndex - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setMockTestIndex(Math.min(mockTest!.questions.length - 1, mockTest!.currentIndex + 1));
      } else if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1;
        if (idx < mockTest!.questions.length) {
          e.preventDefault();
          setMockTestIndex(idx);
        }
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submitMockTest(subject);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, mockTest, setMockTestIndex, submitMockTest, subject]);

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
            <p className="text-4xl font-extrabold text-primary"><AnimatedCounter to={correct} />/{mockTest.results.length}</p>

            <div className="mx-auto h-2 w-48 overflow-hidden rounded-full bg-border-light">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
                style={{ width: `${score}%` }}
              />
            </div>
            <p className="text-lg font-bold text-text-primary"><AnimatedCounter to={score} />%</p>
            <p className="text-sm text-text-secondary">{getMessage()}</p>

            {timeTaken != null && (
              <p className="text-xs text-text-muted">
                Completed in {formatTimeTaken(timeTaken)}
              </p>
            )}

            <div className="flex justify-center gap-4 pt-2">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-success" />
                <span className="text-xs text-text-secondary"><AnimatedCounter to={correct} /> correct</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-error" />
                <span className="text-xs text-text-secondary"><AnimatedCounter to={answered - correct} /> wrong</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-text-muted" />
                <span className="text-xs text-text-secondary"><AnimatedCounter to={unanswered} /> skipped</span>
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
              <DiagnosisTeaser
                diagnosis={mockTest.workSubmissions[i]}
                analyzing={mockTest.workImages[i] != null && mockTest.workSubmissions[i] == null}
              />
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
            onClick={() => submitMockTest(subject)}
          >
            Submit Test
          </Button>
        </div>
      </div>

      {/* Question navigator */}
      <div className="overflow-x-auto -mx-2 px-2 pb-1">
        <div className="flex gap-2 min-w-min md:flex-wrap">
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
            aria-label={isFlagged ? "Unflag for review" : "Flag for review"}
          >
            <FlagIcon className="h-5 w-5" filled={isFlagged} />
          </button>
        </div>

        {mockTest.multipleChoice && current.distractors && current.distractors.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {(() => {
              // Shuffle choices deterministically per question index
              const choices = [current.answer, ...current.distractors];
              const seed = mockTest.currentIndex;
              const shuffled = [...choices].sort((a, b) => {
                const ha = Array.from(a).reduce((h, c) => (h * 31 + c.charCodeAt(0) + seed) | 0, 0);
                const hb = Array.from(b).reduce((h, c) => (h * 31 + c.charCodeAt(0) + seed) | 0, 0);
                return ha - hb;
              });
              return shuffled.map((choice) => (
                <button
                  key={choice}
                  onClick={() => saveMockTestAnswer(mockTest.currentIndex, choice)}
                  className={cn(
                    "rounded-[--radius-md] border px-4 py-3 text-left text-sm font-medium transition-colors",
                    currentAnswer === choice
                      ? "border-primary bg-primary-bg text-primary"
                      : "border-border-light bg-surface text-text-primary hover:border-primary/30",
                  )}
                >
                  {choice}
                </button>
              ));
            })()}
          </div>
        ) : (
          <Input
            placeholder="Your answer..."
            value={currentAnswer}
            onChange={(e) =>
              saveMockTestAnswer(mockTest.currentIndex, e.target.value)
            }
          />
        )}

        {/* Attach work */}
        <AttachWork
          attached={!!mockTest.workImages[mockTest.currentIndex]}
          onAttach={(base64) => attachMockTestWork(mockTest.currentIndex, base64)}
        />

        <div className="flex justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMockTestIndex(Math.max(0, mockTest.currentIndex - 1))}
            disabled={mockTest.currentIndex === 0}
          >
            <kbd className="hidden rounded border border-border bg-input-bg px-1.5 py-0.5 font-mono text-[10px] text-text-muted sm:inline">&larr;</kbd>
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
            <kbd className="hidden rounded border border-border bg-input-bg px-1.5 py-0.5 font-mono text-[10px] text-text-muted sm:inline">&rarr;</kbd>
          </Button>
        </div>
      </Card>
    </div>
  );
}
