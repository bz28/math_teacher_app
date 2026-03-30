"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
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

      {/* Mode selector — pill toggle */}
      <div className="relative flex rounded-full border border-border bg-surface p-1">
        {/* Sliding background indicator */}
        <motion.div
          className="absolute inset-y-1 w-[calc(50%-4px)] rounded-full bg-primary"
          initial={false}
          animate={{ left: mode === "learn" ? "4px" : "calc(50% + 0px)" }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
        {([
          { id: "learn" as const, label: "Learn" },
          { id: "mock-test" as const, label: "Mock Test" },
        ]).map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              "relative z-10 flex-1 rounded-full py-2 text-sm font-semibold transition-colors",
              mode === m.id ? "text-white" : "text-text-secondary hover:text-text-primary",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Mock test config */}
      <AnimatePresence initial={false}>
      {!isLearn && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
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
        </motion.div>
      )}
      </AnimatePresence>

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
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-secondary">
              Problem Queue
            </h3>
            <span className="text-xs font-medium text-text-muted">
              {problemQueue.length}/10
            </span>
          </div>
          {problemQueue.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
              className="group relative rounded-[--radius-lg] bg-surface-raised shadow-sm ring-1 ring-border-light/50 overflow-hidden"
            >
              <div className="flex items-start gap-3 p-4">
                <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-light text-xs font-bold text-white shadow-sm">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-relaxed text-text-primary line-clamp-2">
                    {item.text}
                  </p>
                  {item.image && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`data:image/jpeg;base64,${item.image}`}
                      alt=""
                      className="mt-2 h-20 rounded-[--radius-sm] border border-border-light object-contain"
                    />
                  )}
                </div>
                <button
                  onClick={() => removeFromQueue(i)}
                  className="flex-shrink-0 rounded-full p-1.5 text-text-muted opacity-0 transition-all hover:bg-error-light hover:text-error group-hover:opacity-100"
                  aria-label="Remove problem"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </div>
            </motion.div>
          ))}

          {/* Start button — full width */}
          <Button
            gradient
            onClick={handleStart}
            loading={isLoading}
            disabled={!canStart}
            className="w-full py-3 text-base"
          >
            {isLearn
              ? `Start Learning (${problemQueue.length} problem${problemQueue.length !== 1 ? "s" : ""})`
              : `Start Exam (${problemQueue.length} problem${problemQueue.length !== 1 ? "s" : ""})`}
          </Button>
        </div>
      )}
    </div>
  );
}
