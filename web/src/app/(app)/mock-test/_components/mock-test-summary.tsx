"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button, Card, AnimatedCounter } from "@/components/ui";
import { DiagnosisTeaser } from "@/components/ui/diagnosis-teaser";
import { cn } from "@/lib/utils";
import type { MockTest } from "@/stores/mock-test";

interface MockTestSummaryProps {
  mockTest: MockTest;
  onToggleFlag: (index: number) => void;
  onStartLearnQueue: (problems: string[]) => Promise<void>;
  onReset: () => void;
}

export function MockTestSummary({ mockTest, onToggleFlag, onStartLearnQueue, onReset }: MockTestSummaryProps) {
  const router = useRouter();
  const results = mockTest.results!;
  const correct = results.filter((r) => r.isCorrect === true).length;
  const answered = results.filter((r) => r.userAnswer !== null).length;
  const unanswered = results.length - answered;
  const score = answered > 0 ? Math.round((correct / results.length) * 100) : 0;
  const timeTaken = mockTest.submittedAt && mockTest.startedAt
    ? Math.floor((mockTest.submittedAt - mockTest.startedAt) / 1000)
    : null;
  const flaggedQuestions = results
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
          <p className="text-4xl font-extrabold text-primary"><AnimatedCounter to={correct} />/{results.length}</p>

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
        {results.map((r, i) => (
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
                onClick={() => onToggleFlag(i)}
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
              await onStartLearnQueue(problems);
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
        <Button variant="secondary" onClick={() => { onReset(); router.push("/learn"); }} className="w-full">
          New Exam
        </Button>
        <Button variant="secondary" onClick={() => { onReset(); router.push("/home"); }} className="w-full">
          Return Home
        </Button>
      </div>
    </div>
  );
}
