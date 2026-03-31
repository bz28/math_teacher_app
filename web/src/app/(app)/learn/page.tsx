"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useSessionStore, type Subject } from "@/stores/learn";
import { useMockTestStore } from "@/stores/mock-test";
import { useEntitlementStore } from "@/stores/entitlements";
import { Button, Card } from "@/components/ui";
import { Textarea } from "@/components/ui/input";
import { ImageUpload } from "@/components/shared/image-upload";
import { EntitlementError } from "@/lib/api";
import { UpgradePrompt } from "@/components/shared/upgrade-prompt";
import { cn } from "@/lib/utils";

const SUBJECT_CONFIG: Record<string, { name: string; icon: string; color: string; bg: string }> = {
  math: { name: "Mathematics", icon: "📐", color: "text-primary", bg: "bg-primary-bg" },
  chemistry: { name: "Chemistry", icon: "🧪", color: "text-[#00B894]", bg: "bg-[#00B894]/10" },
};

export default function LearnPage() {
  return (
    <Suspense>
      <LearnPageContent />
    </Suspense>
  );
}

function LearnPageContent() {
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
    phase,
  } = useSessionStore();
  const { startMockTest } = useMockTestStore();
  const { sessionsRemaining, scansRemaining, isPro } = useEntitlementStore();
  const remainingSessions = sessionsRemaining();
  const remainingScans = scansRemaining();

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"learn" | "mock-test">("learn");

  // Mock test config
  const [examType, setExamType] = useState<"use_as_exam" | "generate_similar">("use_as_exam");
  const [untimed, setUntimed] = useState(true);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(30);
  const [multipleChoice, setMultipleChoice] = useState(true);

  useEffect(() => {
    setSubject(subject);
    // Set subject color theme
    document.documentElement.setAttribute("data-subject", subject);
    // Clear stale state when entering the input page
    setProblemQueue([]);
    return () => { document.documentElement.removeAttribute("data-subject"); };
  }, [subject, setSubject, setProblemQueue]);

  const maxQueueSize = isPro ? 10 : Math.min(10, remainingSessions);

  function handleAddProblem() {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!isPro && problemQueue.length >= maxQueueSize) {
      setUpgradePrompt({
        entitlement: "create_session",
        message: remainingSessions <= 0
          ? "You've used all 5 problems for today. Upgrade to Pro for unlimited access."
          : `You've reached your queue limit — free accounts can use ${remainingSessions} more problem${remainingSessions !== 1 ? "s" : ""} today. Remove a problem or upgrade to Pro.`,
      });
      return;
    }
    addToQueue(trimmed);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAddProblem();
    }
  }

  const [starting, setStarting] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<{ entitlement: string; message: string } | null>(null);

  async function handleStart() {
    if (starting) return;
    if (problemQueue.length === 0 && !input.trim()) return;
    if (!isPro && remainingSessions <= 0) {
      setUpgradePrompt({ entitlement: "create_session", message: "You've used all 5 problems for today. Upgrade to Pro for unlimited access." });
      return;
    }
    setStarting(true);

    const problems =
      problemQueue.length > 0 ? problemQueue.map((p) => p.text) : [input.trim()];
    const firstImage = problemQueue.length > 0 ? problemQueue[0].image : undefined;

    try {
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
        await startMockTest(problems, generateCount, timeLimit, subject, problemQueue, multipleChoice);
        router.push(`/mock-test?subject=${subject}`);
      }
    } catch (err) {
      if (err instanceof EntitlementError) {
        setUpgradePrompt({ entitlement: err.entitlement, message: err.message });
      }
      setStarting(false);
    }
  }

  const isLoading = phase === "loading";
  const isLearn = mode === "learn";
  const canStart = problemQueue.length > 0 || input.trim().length > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
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
        <Card variant="flat">
          <div className="flex flex-wrap items-center gap-4">
            {/* Questions type — inline pill toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-text-muted">Questions:</span>
              <div className="flex rounded-full border border-border bg-surface p-0.5">
                {([
                  { id: "use_as_exam" as const, label: "Use mine" },
                  { id: "generate_similar" as const, label: "Generate similar" },
                ]).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setExamType(opt.id)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                      examType === opt.id
                        ? "bg-primary text-white"
                        : "text-text-secondary hover:text-text-primary",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Time limit — inline toggle + stepper */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-text-muted">Time:</span>
              <div className="flex items-center rounded-full border border-border bg-surface p-0.5">
                <button
                  onClick={() => setUntimed(true)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                    untimed ? "bg-primary text-white" : "text-text-secondary hover:text-text-primary",
                  )}
                >
                  Untimed
                </button>
                <button
                  onClick={() => setUntimed(false)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                    !untimed ? "bg-primary text-white" : "text-text-secondary hover:text-text-primary",
                  )}
                >
                  Timed
                </button>
              </div>
              {!untimed && (
                <div className="flex items-center rounded-full border border-border-light bg-surface">
                  <button
                    onClick={() => setTimeLimitMinutes(Math.max(1, timeLimitMinutes - 5))}
                    disabled={timeLimitMinutes <= 1}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-xs text-primary disabled:opacity-30"
                  >
                    -
                  </button>
                  <span className="min-w-[40px] text-center text-xs font-semibold text-primary">
                    {timeLimitMinutes}m
                  </span>
                  <button
                    onClick={() => setTimeLimitMinutes(Math.min(180, timeLimitMinutes + 5))}
                    disabled={timeLimitMinutes >= 180}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-xs text-primary disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              )}
            </div>

            {/* Answer format */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-text-muted">Answers:</span>
              <div className="flex rounded-full border border-border bg-surface p-0.5">
                <button
                  onClick={() => setMultipleChoice(true)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                    multipleChoice ? "bg-primary text-white" : "text-text-secondary hover:text-text-primary",
                  )}
                >
                  Multiple choice
                </button>
                <button
                  onClick={() => setMultipleChoice(false)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                    !multipleChoice ? "bg-primary text-white" : "text-text-secondary hover:text-text-primary",
                  )}
                >
                  Free response
                </button>
              </div>
            </div>
          </div>
        </Card>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Add problems — image upload + text input */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Image upload */}
        <Card variant="flat" className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">
            Upload a photo
          </p>
          <ImageUpload
            subject={subject}
            onProblemsExtracted={(problems) => {
              problems.forEach((p) => addToQueue(p.text, p.image));
            }}
            maxProblems={maxQueueSize}
            currentQueueLength={problemQueue.length}
            scansRemaining={remainingScans}
            onScanLimitReached={() => setUpgradePrompt({
              entitlement: "image_scan",
              message: "You've used all 3 image scans for today. Upgrade to Pro for unlimited scans.",
            })}
          />
        </Card>

        {/* Text input */}
        <Card variant="flat" className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">
            Or type a problem
          </p>
          <Textarea
            placeholder="Enter your problem here... (Shift+Enter for new line)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[80px]"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleAddProblem}
            disabled={!input.trim() || problemQueue.length >= 10}
            className="w-full"
          >
            Add to Queue
          </Button>
        </Card>
      </div>

      {/* Start button when queue is empty but input has text */}
      {problemQueue.length === 0 && input.trim() && (
        <Button
          gradient
          onClick={handleStart}
          loading={isLoading || starting}
          className="w-full py-3 text-base"
        >
          {isLearn ? "Start Learning" : "Start Exam"}
        </Button>
      )}

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
            loading={isLoading || starting}
            disabled={!canStart}
            className="w-full py-3 text-base"
          >
            {isLearn
              ? `Start Learning (${problemQueue.length} problem${problemQueue.length !== 1 ? "s" : ""})`
              : `Start Exam (${problemQueue.length} problem${problemQueue.length !== 1 ? "s" : ""})`}
          </Button>
          {!isPro && remainingSessions < Infinity && (
            <p className="text-center text-xs text-text-muted">
              {remainingSessions} of 5 problems remaining today
            </p>
          )}
        </div>
      )}
      <UpgradePrompt
        open={upgradePrompt !== null}
        onClose={() => setUpgradePrompt(null)}
        entitlement={upgradePrompt?.entitlement}
        message={upgradePrompt?.message}
      />
    </div>
  );
}
