"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore, type Subject } from "@/stores/session";
import { Button, Card } from "@/components/ui";
import { Textarea } from "@/components/ui/input";
import { ImageUpload } from "@/components/shared/image-upload";
import { cn } from "@/lib/utils";

const SUBJECT_CONFIG: Record<string, { name: string; icon: string; color: string; bg: string }> = {
  math: { name: "Mathematics", icon: "📐", color: "text-primary", bg: "bg-primary-bg" },
  chemistry: { name: "Chemistry", icon: "🧪", color: "text-[#00B894]", bg: "bg-[#00B894]/10" },
};

export default function LearnPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const subject = (searchParams.get("subject") ?? "math") as Subject;

  const {
    setSubject,
    problemQueue,
    setProblemQueue,
    addToQueue,
    removeFromQueue,
    startLearnQueue,
    startSession,
    startMockTest,
    phase,
  } = useSessionStore();

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"learn" | "mock-test">("learn");

  // Mock test config
  const [examType, setExamType] = useState<"use_as_exam" | "generate_similar">("use_as_exam");
  const [untimed, setUntimed] = useState(true);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(30);

  useEffect(() => {
    setSubject(subject);
    // Clear stale state when entering the input page
    setProblemQueue([]);
  }, [subject, setSubject, setProblemQueue]);

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
      problemQueue.length > 0 ? problemQueue.map((p) => p.text) : [input.trim()];
    const firstImage = problemQueue.length > 0 ? problemQueue[0].image : undefined;

    if (mode === "learn") {
      if (problems.length === 1) {
        await startSession(problems[0], firstImage);
      } else {
        await startLearnQueue(problems);
      }
      router.push(`/learn/session?subject=${subject}`);
    } else {
      const generateCount = examType === "generate_similar" ? problems.length : 0;
      const timeLimit = untimed ? null : timeLimitMinutes;
      await startMockTest(problems, generateCount, timeLimit);
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
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => router.push("/home")}
            className="flex items-center gap-1 text-sm font-medium text-text-muted hover:text-primary transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          {SUBJECT_CONFIG[subject] && (
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
              SUBJECT_CONFIG[subject].bg,
              SUBJECT_CONFIG[subject].color,
            )}>
              {SUBJECT_CONFIG[subject].icon} {SUBJECT_CONFIG[subject].name}
            </span>
          )}
        </div>
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
                : "border-border bg-surface hover:border-primary/30"
            }`}
          >
            <p className={`text-sm font-bold ${mode === m.id ? "text-primary" : "text-text-primary"}`}>
              {m.label}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">{m.desc}</p>
          </button>
        ))}
      </div>

      {/* Mock test config */}
      {!isLearn && (
        <Card variant="flat" className="space-y-4">
          {/* Questions type */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              Questions
            </p>
            {([
              { id: "use_as_exam" as const, label: "Use these as my exam", hint: null },
              { id: "generate_similar" as const, label: "Generate a similar exam", hint: "Fresh questions based on yours" },
            ]).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setExamType(opt.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[--radius-md] border p-3 text-left transition-colors",
                  examType === opt.id
                    ? "border-primary bg-primary-bg"
                    : "border-border-light bg-surface hover:border-primary/30",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2",
                    examType === opt.id ? "border-primary" : "border-text-muted",
                  )}
                >
                  {examType === opt.id && (
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  )}
                </span>
                <div>
                  <p className={cn("text-sm font-semibold", examType === opt.id ? "text-primary" : "text-text-primary")}>
                    {opt.label}
                  </p>
                  {opt.hint && (
                    <p className="text-xs text-text-muted">{opt.hint}</p>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Time limit */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              Time Limit
            </p>
            <button
              onClick={() => setUntimed(true)}
              className={cn(
                "flex w-full items-center gap-3 rounded-[--radius-md] border p-3 text-left transition-colors",
                untimed
                  ? "border-primary bg-primary-bg"
                  : "border-border-light bg-surface hover:border-primary/30",
              )}
            >
              <span className={cn("flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2", untimed ? "border-primary" : "border-text-muted")}>
                {untimed && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
              </span>
              <p className={cn("text-sm font-semibold", untimed ? "text-primary" : "text-text-primary")}>No time limit</p>
            </button>
            <div
              onClick={() => setUntimed(false)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-[--radius-md] border p-3 text-left transition-colors",
                !untimed
                  ? "border-primary bg-primary-bg"
                  : "border-border-light bg-surface hover:border-primary/30",
              )}
            >
              <span className={cn("flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2", !untimed ? "border-primary" : "border-text-muted")}>
                {!untimed && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
              </span>
              <p className={cn("text-sm font-semibold", !untimed ? "text-primary" : "text-text-primary")}>Timed</p>
              {!untimed && (
                <div className="ml-auto flex items-center gap-0 rounded-[--radius-sm] border border-border-light bg-surface">
                  <button
                    onClick={(e) => { e.stopPropagation(); setTimeLimitMinutes(Math.max(1, timeLimitMinutes - 5)); }}
                    disabled={timeLimitMinutes <= 1}
                    className="flex h-8 w-8 items-center justify-center text-primary disabled:opacity-30"
                  >
                    -
                  </button>
                  <span className="min-w-[50px] text-center text-xs font-semibold text-primary">
                    {timeLimitMinutes} min
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setTimeLimitMinutes(Math.min(180, timeLimitMinutes + 5)); }}
                    disabled={timeLimitMinutes >= 180}
                    className="flex h-8 w-8 items-center justify-center text-primary disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Image upload */}
      <ImageUpload
        subject={subject}
        onProblemsExtracted={(problems) => {
          problems.forEach((p) => addToQueue(p.text, p.image));
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
          {problemQueue.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-[--radius-md] border border-border-light bg-surface px-4 py-3"
            >
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-bg text-xs font-bold text-primary">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary">{item.text}</p>
                {item.image && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`data:image/jpeg;base64,${item.image}`}
                    alt=""
                    className="mt-1.5 h-16 rounded border border-border object-contain"
                  />
                )}
              </div>
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
