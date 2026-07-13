"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/stores/learn";
import { usePracticeStore } from "@/stores/practice";
import { session as sessionApi } from "@/lib/api";
import { Button, Badge, Card, PageErrorState } from "@/components/ui";
import { useRedirectOnIdle } from "@/hooks/use-session-effects";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { GeneratingState } from "@/components/shared/generating-state";
import { useConfetti } from "@/components/ui/confetti";
import { MCQCard } from "@/components/shared/mcq-card";
import { ProgressBar } from "@/components/shared/progress-bar";
import { PracticeSummary } from "./_components/practice-summary";
import { MathText } from "@/components/shared/math-text";

export default function PracticePage() {
  const router = useRouter();
  const { startLearnQueue, subject } = useSessionStore();
  const {
    practiceBatch,
    phase,
    beginPractice,
    submitPracticeAnswer,
    skipPracticeProblem,
    nextPracticeProblem,
    togglePracticeFlag,
    retryLastGeneration,
    lastGeneration,
    reset,
  } = usePracticeStore();

  const { fire: fireConfetti } = useConfetti();
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const { UpgradeModal } = useUpgradePrompt();

  // Build MC choices — must be before early returns (rules of hooks)
  const currentProblem = practiceBatch?.problems[practiceBatch.currentIndex];
  const choices = useMemo(() => {
    if (!currentProblem?.answer || !currentProblem.distractors?.length) return [];
    const all = [currentProblem.answer, ...currentProblem.distractors.slice(0, 3)];
    const seed = (currentProblem.question.length + (practiceBatch?.currentIndex ?? 0)) | 0;
    return all.sort((a, b) => {
      const ha = Array.from(a).reduce((h, c) => h * 31 + c.charCodeAt(0) + seed, 0);
      const hb = Array.from(b).reduce((h, c) => h * 31 + c.charCodeAt(0) + seed, 0);
      return ha - hb;
    });
  }, [currentProblem, practiceBatch?.currentIndex]);

  useRedirectOnIdle(phase, practiceBatch);

  // Confetti on perfect practice score + complete session for history
  useEffect(() => {
    if (phase === "practice_summary" && practiceBatch) {
      const allCorrect = practiceBatch.results.every((r) => r.isCorrect);
      if (allCorrect) fireConfetti(true);

      // Record in history
      if (practiceBatch.sessionId) {
        const correct = practiceBatch.results.filter((r) => r.isCorrect).length;
        sessionApi.completePracticeBatch(practiceBatch.sessionId, {
          total_questions: practiceBatch.results.length,
          correct_count: correct,
        }).catch(() => { /* session may already be completed — safe to ignore */ });
      }
    }
  }, [phase, practiceBatch, fireConfetti]);

  async function handleChoiceSelect(choice: string) {
    setSelectedChoice(choices.indexOf(choice));
    await submitPracticeAnswer(choice, subject);
  }

  // Error is terminal — check it BEFORE the loading/!practiceBatch guard.
  // On a failed fresh generation the store sets phase "error" while
  // practiceBatch is still null, so a loading-first guard would trap the
  // student on the "Building…" state forever and never reach recovery.
  if (phase === "error") {
    // Generation failed. Retry in place with the exact seed that failed
    // (stashed in lastGeneration before the API call). "Back to Learn"
    // stays as a secondary escape. Branded surface only (the duplicate
    // error toast was removed) so the failure shows once.
    return (
      <PageErrorState
        title="That didn't generate"
        message="We couldn't build your practice set just now. Try again, or head back to Learn to start over."
        retryLabel={lastGeneration ? "Try again" : "Back to Learn"}
        onRetry={lastGeneration ? () => { retryLastGeneration().catch(() => {}); } : () => router.push("/learn")}
        secondaryLabel={lastGeneration ? "Back to Learn" : undefined}
        onSecondary={lastGeneration ? () => router.push("/learn") : undefined}
      />
    );
  }

  if (phase === "loading" || !practiceBatch) {
    return (
      <GeneratingState
        message={
          <>
            Building your <span className="font-display-serif italic text-primary">practice…</span>
          </>
        }
        subtext="Tailoring a fresh set of problems to what you're working on. This takes a few seconds."
      />
    );
  }

  if (phase === "practice_preview") {
    const allSolved = practiceBatch.problems.every((q) => q.answer !== "");
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="font-serif text-[2.5rem] leading-[1.05] text-text-primary sm:text-[3rem]">
            Your practice is <span className="font-display-serif italic text-primary">ready.</span>
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            {practiceBatch.problems.length} question{practiceBatch.problems.length !== 1 ? "s" : ""} · Review before you begin
          </p>
        </div>
        <div className="space-y-3">
          {practiceBatch.problems.map((q, i) => (
            <div key={i} className="flex items-start gap-3 rounded-[--radius-lg] border border-border bg-surface px-4 py-3">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-bg text-xs font-bold text-primary">
                {i + 1}
              </span>
              <div className="flex-1 text-sm font-medium text-text-primary">
                <MathText text={q.question} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Button
            onClick={beginPractice}
            className="w-full py-3 text-base"
          >
            {allSolved ? "Begin Practice" : (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Preparing answer choices…
              </span>
            )}
          </Button>
          <Button variant="ghost" onClick={() => { reset(); router.back(); }} className="w-full">
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // Summary view
  if (phase === "practice_summary") {
    return (
      <PracticeSummary
        practiceBatch={practiceBatch}
        onToggleFlag={togglePracticeFlag}
        onStartLearnQueue={startLearnQueue}
        onReset={reset}
      />
    );
  }

  // Active practice
  const current = practiceBatch.problems[practiceBatch.currentIndex];
  const isThinking = phase === "thinking";
  const feedback = practiceBatch.currentFeedback;
  const progress = (practiceBatch.currentIndex / practiceBatch.problems.length) * 100;
  const isLast = practiceBatch.currentIndex >= practiceBatch.problems.length - 1;

  // Terminal-empty distractor case: the answer resolved but the backend
  // returned no usable distractors (an exception, or dedup collapsed them
  // all — practice.py returns []), so no multiple-choice can be built. An
  // empty `choices` while the answer is still resolving is a legitimate
  // loading state and must NOT trip this — gate on the answer being ready.
  const answerReady = current.answer !== "";
  const noChoices = answerReady && choices.length === 0;

  function skipUnbuildable() {
    // Advance without recording a wrong result — an unanswerable problem
    // shouldn't count against the student or get them flagged.
    setSelectedChoice(null);
    nextPracticeProblem();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Practice</h1>
        <Badge variant="info">
          {practiceBatch.currentIndex + 1} of {practiceBatch.problems.length}
        </Badge>
      </div>

      <ProgressBar value={progress} />

      {noChoices ? (
        <Card variant="elevated" className="space-y-4">
          <div className="text-base font-medium text-text-primary">
            <MathText text={current.question} />
          </div>
          <div className="rounded-[--radius-md] border border-border bg-input-bg/60 p-4 text-center">
            <p className="text-sm font-semibold text-text-primary">
              We couldn&apos;t build answer choices for this one
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              Something went wrong generating the options. Skip ahead — this
              one won&apos;t count against you.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={skipUnbuildable}
              className="mt-4"
            >
              {isLast ? "See Results" : "Skip to next problem"}
            </Button>
          </div>
        </Card>
      ) : (
        <MCQCard
          question={current.question}
          choices={choices}
          selectedChoice={selectedChoice}
          feedback={feedback}
          isThinking={isThinking}
          onSelectChoice={handleChoiceSelect}
          onAdvance={() => {
            setSelectedChoice(null);
            nextPracticeProblem();
          }}
          advanceLabel={isLast ? "See Results" : "Next Problem"}
          belowChoices={
            <button
              onClick={skipPracticeProblem}
              disabled={isThinking}
              className="text-xs font-medium text-text-muted hover:text-text-secondary transition-colors"
            >
              Skip this problem
            </button>
          }
        />
      )}
      {UpgradeModal}
    </div>
  );
}
