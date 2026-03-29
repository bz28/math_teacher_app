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
    startMockTest,
    phase,
  } = useSessionStore();

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"learn" | "mock-test">("learn");

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

    const problems =
      problemQueue.length > 0 ? problemQueue : [input.trim()];

    if (mode === "learn") {
      if (problems.length === 1) {
        await startSession(problems[0]);
      } else {
        await startLearnQueue(problems);
      }
      router.push(`/learn/session?subject=${subject}`);
    } else {
      await startMockTest(problems, problems.length === 1 ? 5 : 0, null);
      router.push(`/mock-test?subject=${subject}`);
    }
  }

  const isLoading = phase === "loading";
  const isLearn = mode === "learn";
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
          {isLearn ? "What do you need help with?" : "Build your exam"}
        </h1>
      </motion.div>

      {/* Mode selector — Learn and Mock Test only */}
      <div className="flex gap-2">
        {([
          { id: "learn" as const, label: "Learn", desc: "Step-by-step guided learning" },
          { id: "mock-test" as const, label: "Mock Test", desc: "Practice or generate an exam" },
        ]).map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`flex-1 rounded-[--radius-md] border p-3 text-left transition-colors ${
              mode === m.id
                ? "border-primary bg-primary-bg"
                : "border-border bg-white hover:border-primary/30"
            }`}
          >
            <p className={`text-sm font-bold ${mode === m.id ? "text-primary" : "text-text-primary"}`}>
              {m.label}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">{m.desc}</p>
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
            isLearn
              ? "Type your problem here... (Shift+Enter for new line)"
              : "Enter a problem (we'll generate similar questions for the exam)"
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
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAddProblem}
              disabled={!input.trim() || problemQueue.length >= 10}
            >
              Add to Queue
            </Button>
            <Button
              size="sm"
              gradient
              onClick={handleStart}
              loading={isLoading}
              disabled={!canStart}
            >
              {isLearn
                ? `Start Learn${problemQueue.length > 0 ? ` (${problemQueue.length})` : ""}`
                : `Start Exam${problemQueue.length > 0 ? ` (${problemQueue.length})` : ""}`}
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
