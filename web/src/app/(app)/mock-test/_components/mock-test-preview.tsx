"use client";

import { motion } from "framer-motion";
import { Button, Card } from "@/components/ui";
import { MathText } from "@/components/shared/math-text";
import type { MockTest } from "@/stores/mock-test";

interface MockTestPreviewProps {
  mockTest: MockTest;
  isTimed: boolean;
  onBegin: () => void;
  onCancel: () => void;
}

export function MockTestPreview({ mockTest, isTimed, onBegin, onCancel }: MockTestPreviewProps) {
  const allSolved = mockTest.questions.every((q) => q.answer !== "");
  // Allow the student to begin once every background solve request has
  // settled — even if some failed. Without this, a single permanently-
  // failed solve would leave the Begin button disabled forever.
  const canBegin = allSolved || mockTest.solveSettled;
  const partialFailure = mockTest.solveSettled && mockTest.solveErrorCount > 0;

  if (isTimed) {
    // Timed: intermission screen, no question texts shown (no peeking), user clicks Begin when ready
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-bg">
          {canBegin ? (
            <svg className="h-8 w-8 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="h-8 w-8 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-text-primary">
            {canBegin ? "Your exam is ready" : "Preparing your exam…"}
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            {mockTest.questions.length} question{mockTest.questions.length !== 1 ? "s" : ""} ·{" "}
            {mockTest.timeLimitSeconds ? `${Math.round(mockTest.timeLimitSeconds / 60)} min` : "Untimed"}
          </p>
          {canBegin && (
            <p className="mt-1 text-xs text-text-muted">Timer starts when you click Begin</p>
          )}
        </div>
        {partialFailure && (
          <p className="rounded-[--radius-md] border border-warning-dark/20 bg-warning-bg px-3 py-2 text-xs text-warning-dark">
            Couldn&apos;t prepare {mockTest.solveErrorCount} of {mockTest.questions.length} answers — those questions will be ungraded at submit time.
          </p>
        )}
        <div className="flex flex-col gap-3 w-full">
          <Button
            gradient
            onClick={onBegin}
            disabled={!canBegin}
            className="w-full py-3 text-base"
          >
            {canBegin ? "Begin Exam" : (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Preparing answers…
              </span>
            )}
          </Button>
          <button
            onClick={onCancel}
            className="text-sm font-medium text-text-muted hover:text-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Untimed: preview with question list + Begin button
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-extrabold text-text-primary">Your exam is ready</h1>
        <p className="mt-1 text-sm text-text-muted">
          {mockTest.questions.length} question{mockTest.questions.length !== 1 ? "s" : ""} · Review before you begin
        </p>
      </motion.div>

      <div className="space-y-3">
        {mockTest.questions.map((q, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * i }}
          >
            <Card variant="flat" className="flex items-start gap-3">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-bg text-xs font-bold text-primary">
                {i + 1}
              </span>
              <div className="flex-1 text-sm font-medium text-text-primary">
                <MathText text={q.question} />
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {partialFailure && (
        <p className="rounded-[--radius-md] border border-warning-dark/20 bg-warning-bg px-3 py-2 text-xs text-warning-dark">
          Couldn&apos;t prepare {mockTest.solveErrorCount} of {mockTest.questions.length} answers — those questions will be ungraded at submit time.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <Button
          gradient
          onClick={onBegin}
          disabled={!canBegin}
          className="w-full py-3 text-base"
        >
          {canBegin ? "Begin Exam" : (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Preparing answers…
            </span>
          )}
        </Button>
        <Button variant="ghost" onClick={onCancel} className="w-full">
          Cancel
        </Button>
      </div>
    </div>
  );
}
