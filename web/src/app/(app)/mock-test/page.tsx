"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/stores/learn";
import { useMockTestStore } from "@/stores/mock-test";
import { useEntitlementStore } from "@/stores/entitlements";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { Button, Card, Badge } from "@/components/ui";
import { useRedirectOnIdle, useErrorToast } from "@/hooks/use-session-effects";
import { Input } from "@/components/ui/input";
import { useConfetti } from "@/components/ui/confetti";
import { AttachWork } from "@/components/ui/attach-work";
import { FlagIcon } from "@/components/ui/icons";
import { MockTestSummary } from "./_components/mock-test-summary";
import { cn } from "@/lib/utils";
import { MathText } from "@/components/shared/math-text";
import { LoadingHero } from "@/components/shared/loading-hero";

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

  const { isPro } = useEntitlementStore();

  const { fire: fireConfetti } = useConfetti();
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const { showUpgrade, UpgradeModal } = useUpgradePrompt();

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

  useRedirectOnIdle(phase, mockTest);
  useErrorToast(phase, error);

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
    // !mockTest → creating the test from Solve (setup phase).
    // mockTest exists + loading → user hit Submit, we're grading.
    const loadingMode = !mockTest ? "test" : "grading";
    return <LoadingHero subject={subject} mode={loadingMode} />;
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
    return (
      <MockTestSummary
        mockTest={mockTest}
        onToggleFlag={toggleMockTestFlag}
        onStartLearnQueue={startLearnQueue}
        onReset={reset}
      />
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
      {/* Header with timer — mobile parity: timer pill, error color when <5min */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Mock Test</h1>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex items-center gap-2 rounded-[--radius-lg] border bg-surface px-3 py-1.5 text-xs font-semibold",
              timeLeft !== null && timeLeft < 5 * 60
                ? "border-error text-error"
                : "border-border text-text-secondary",
            )}
            aria-label={timeLeft !== null ? `Time remaining: ${formatTime(timeLeft)}` : "Untimed"}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {timeLeft !== null ? formatTime(timeLeft) : "Untimed"}
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => submitMockTest(subject)}
          >
            Submit
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
            <div className="mt-3 text-base font-medium text-text-primary">
              <MathText text={current.question} />
            </div>
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

        {mockTest.multipleChoice ? (
          current.distractors && current.distractors.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {(() => {
                // Shuffle choices deterministically per question index
                const choices = [current.answer, ...current.distractors];
                const seed = mockTest.currentIndex;
                const shuffled = [...choices].sort((a, b) => {
                  const ha = Array.from(a).reduce((h, c) => (h * 31 + c.charCodeAt(0) + seed) | 0, 0);
                  const hb = Array.from(b).reduce((h, c) => (h * 31 + c.charCodeAt(0) + seed) | 0, 0);
                  return ha - hb;
                });
                return shuffled.map((choice, i) => {
                  const selected = currentAnswer === choice;
                  const letter = String.fromCharCode(65 + i);
                  return (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => saveMockTestAnswer(mockTest.currentIndex, choice)}
                      className={cn(
                        "flex items-center gap-3 rounded-[--radius-lg] border-[1.5px] px-4 py-4 text-left text-sm font-medium transition-colors",
                        selected
                          ? "border-primary bg-primary-bg text-primary"
                          : "border-border bg-surface text-text-primary hover:border-primary/40",
                      )}
                      aria-pressed={selected}
                    >
                      <span
                        className={cn(
                          "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold",
                          selected
                            ? "bg-primary text-white"
                            : "bg-input-bg text-text-secondary",
                        )}
                      >
                        {letter}
                      </span>
                      <span className="flex-1">
                        <MathText text={choice} />
                      </span>
                    </button>
                  );
                });
              })()}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-8 text-text-muted">
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm font-medium">Loading choices…</span>
            </div>
          )
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
          isPro={isPro}
          onUpgradeNeeded={() => showUpgrade("work_diagnosis", "Get detailed feedback on your work — step-by-step accuracy analysis and tailored learning. Upgrade to Pro to unlock.")}
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
      {UpgradeModal}
    </div>
  );
}
