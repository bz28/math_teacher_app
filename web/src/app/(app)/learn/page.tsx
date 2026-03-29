"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore, type Subject } from "@/stores/session";
import { Button, Card } from "@/components/ui";
import { Textarea } from "@/components/ui/input";
import { ImageUpload } from "@/components/shared/image-upload";

export default function LearnPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const subject = (searchParams.get("subject") ?? "math") as Subject;

  const {
    setSubject,
    problemQueue,
    addToQueue,
    removeFromQueue,
    startLearnQueue,
    startSession,
    startPracticeBatch,
    startMockTest,
    phase,
  } = useSessionStore();

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"learn" | "practice" | "mock-test">("learn");

  useEffect(() => {
    setSubject(subject);
  }, [subject, setSubject]);

  function handleAddProblem() {
    const trimmed = input.trim();
    if (!trimmed) return;
    addToQueue(trimmed);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAddProblem();
    }
  }

  async function handleStart() {
    if (problemQueue.length === 0 && !input.trim()) return;

    // If there's text in input but not added to queue, add it
    const problems =
      problemQueue.length > 0
        ? problemQueue
        : [input.trim()];

    switch (mode) {
      case "learn":
        if (problems.length === 1) {
          await startSession(problems[0]);
        } else {
          await startLearnQueue(problems);
        }
        router.push(`/learn/session?subject=${subject}`);
        break;
      case "practice":
        await startPracticeBatch(problems[0], 5);
        router.push(`/practice?subject=${subject}`);
        break;
      case "mock-test":
        await startMockTest(problems, problems.length === 1 ? 5 : 0, null);
        router.push(`/mock-test?subject=${subject}`);
        break;
    }
  }

  const isLoading = phase === "loading";
  const subjectLabel = subject === "math" ? "Mathematics" : "Chemistry";
  const canStart = problemQueue.length > 0 || input.trim().length > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <button
          onClick={() => router.push("/home")}
          className="mb-4 flex items-center gap-1 text-sm font-medium text-text-muted hover:text-primary transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
          {subjectLabel}
        </h1>
        <p className="mt-1 text-text-secondary">
          Enter a problem to get started
        </p>
      </motion.div>

      {/* Mode selector */}
      <div className="flex gap-2">
        {(
          [
            { id: "learn", label: "Learn" },
            { id: "practice", label: "Practice" },
            { id: "mock-test", label: "Mock Test" },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`rounded-[--radius-pill] px-4 py-2 text-sm font-semibold transition-colors ${
              mode === m.id
                ? "bg-primary text-white"
                : "bg-primary-bg text-primary hover:bg-primary/10"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Image upload */}
      <ImageUpload
        subject={subject}
        onProblemsExtracted={(problems) => {
          problems.forEach((p) => addToQueue(p));
        }}
        maxProblems={10}
        currentQueueLength={problemQueue.length}
      />

      {/* Problem input */}
      <Card variant="flat" className="space-y-4">
        <Textarea
          placeholder={
            mode === "mock-test"
              ? "Enter a problem (we'll generate similar questions for the exam)"
              : "Type your problem here... (Shift+Enter for new line)"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-[80px]"
        />

        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {problemQueue.length}/10 problems
          </span>
          <div className="flex gap-2">
            {mode !== "practice" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAddProblem}
                disabled={!input.trim() || problemQueue.length >= 10}
              >
                Add to Queue
              </Button>
            )}
            <Button
              size="sm"
              gradient
              onClick={handleStart}
              loading={isLoading}
              disabled={!canStart}
            >
              {mode === "learn"
                ? "Start Learning"
                : mode === "practice"
                  ? "Start Practice"
                  : "Start Exam"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Problem queue */}
      {problemQueue.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="space-y-2"
        >
          <h3 className="text-sm font-semibold text-text-secondary">
            Problem Queue
          </h3>
          {problemQueue.map((problem, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-[--radius-md] border border-border-light bg-white px-4 py-3"
            >
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-bg text-xs font-bold text-primary">
                {i + 1}
              </span>
              <p className="flex-1 text-sm text-text-primary">{problem}</p>
              <button
                onClick={() => removeFromQueue(i)}
                className="flex-shrink-0 text-text-muted hover:text-error transition-colors"
                aria-label="Remove problem"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
