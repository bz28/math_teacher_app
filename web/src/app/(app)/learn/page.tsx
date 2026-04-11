"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useSessionStore, type Subject } from "@/stores/learn";
import { useMockTestStore } from "@/stores/mock-test";
import { useEntitlementStore } from "@/stores/entitlements";
import { Button, Card } from "@/components/ui";
import { Textarea } from "@/components/ui/input";
import { EditProblemTextarea } from "@/components/shared/edit-problem-textarea";
import { ImageUpload } from "@/components/shared/image-upload";
import { MathText } from "@/components/shared/math-text";
import { EntitlementError } from "@/lib/api";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { cn } from "@/lib/utils";
import { FREE_DAILY_SESSION_LIMIT, FREE_DAILY_SCAN_LIMIT, SUBJECT_CONFIG } from "@/lib/constants";
import { DifficultyPicker, type Difficulty } from "@/components/shared/difficulty-picker";

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
  const sectionId = searchParams.get("section");

  const {
    setSubject,
    setSectionId,
    problemQueue,
    setProblemQueue,
    addToQueue,
    updateInQueue,
    removeFromQueue,
    startLearnQueue,
    startSession,
    phase,
  } = useSessionStore();
  const { startMockTest } = useMockTestStore();
  const { isPro, dailySessionsUsed, dailySessionsLimit, dailyScansUsed, dailyScansLimit, fetchEntitlements } = useEntitlementStore();
  const remainingSessions = isPro ? Infinity : Math.max(0, dailySessionsLimit - dailySessionsUsed);
  const remainingScans = isPro ? Infinity : Math.max(0, dailyScansLimit - dailyScansUsed);

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"learn" | "mock-test">("learn");
  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);

  // Mock test config
  const [examType, setExamType] = useState<"use_as_exam" | "generate_similar">("use_as_exam");
  const [untimed, setUntimed] = useState(true);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(30);
  const [difficulty, setDifficulty] = useState<Difficulty>("same");

  useEffect(() => {
    setSubject(subject);
    setSectionId(sectionId);
    document.documentElement.setAttribute("data-subject", subject);
    setProblemQueue([]);
    // Refresh quota counts so remaining is accurate
    fetchEntitlements();
    return () => { document.documentElement.removeAttribute("data-subject"); };
  }, [subject, sectionId, setSubject, setSectionId, setProblemQueue, fetchEntitlements]);

  const maxQueueSize = isPro ? 10 : Math.min(10, remainingSessions);

  function handleAddProblem() {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!isPro && problemQueue.length >= maxQueueSize) {
      const msg = problemQueue.length > 0
        ? `Your queue is full — you have ${remainingSessions} problem${remainingSessions !== 1 ? "s" : ""} remaining today. Remove one to add another, or upgrade to Pro.`
        : `You've used all ${FREE_DAILY_SESSION_LIMIT} problems for today. Upgrade to Pro for unlimited access.`;
      showUpgrade("create_session", msg);
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
  const { showUpgrade, UpgradeModal } = useUpgradePrompt();
  const [quotaConfirm, setQuotaConfirm] = useState(false);
  const [imagePhase, setImagePhase] = useState<"upload" | "select" | "extracting">("upload");
  const isScanning = imagePhase === "select" || imagePhase === "extracting";

  async function handleStart() {
    if (starting) return;
    if (problemQueue.length === 0 && !input.trim()) return;
    if (!isPro && remainingSessions <= 0) {
      showUpgrade("create_session", `You've used all ${FREE_DAILY_SESSION_LIMIT} problems for today. Upgrade to Pro for unlimited access.`);
      return;
    }

    const problemCount = problemQueue.length > 0 ? problemQueue.length : 1;
    if (!isPro && problemCount > 1 && !quotaConfirm) {
      setQuotaConfirm(true);
      return;
    }
    setQuotaConfirm(false);
    setStarting(true);
    setEditingQueueIndex(null);

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
        await startMockTest(problems, generateCount, timeLimit, subject, problemQueue, true, examType === "generate_similar" ? difficulty : "same");
        router.push(`/mock-test?subject=${subject}`);
      }
    } catch (err) {
      if (err instanceof EntitlementError) {
        showUpgrade(err.entitlement, err.message);
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

            {/* Difficulty — only for generate similar */}
            {examType === "generate_similar" && (
              <DifficultyPicker value={difficulty} onChange={setDifficulty} />
            )}

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
            onScanLimitReached={() => showUpgrade("image_scan", `You've used all ${FREE_DAILY_SCAN_LIMIT} image scans for today. Upgrade to Pro for unlimited scans.`)}
            onExtractComplete={fetchEntitlements}
            onPhaseChange={setImagePhase}
          />
        </Card>

        {/* Text input */}
        <Card variant="flat" className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">
            Or type a problem
          </p>
          <Textarea
            placeholder={isScanning ? "Finish scanning first..." : "Enter your problem here... (Shift+Enter for new line)"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isScanning}
            className="min-h-[80px]"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleAddProblem}
            disabled={isScanning || !input.trim() || problemQueue.length >= maxQueueSize}
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
          {problemQueue.map((item, i) => {
            const isEditing = editingQueueIndex === i;
            return (
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
                  {isEditing ? (
                    <div className="flex-1 min-w-0">
                      <EditProblemTextarea
                        value={item.text}
                        onChange={(text) => updateInQueue(i, text)}
                        onDone={() => setEditingQueueIndex(null)}
                      />
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium leading-relaxed text-text-primary">
                        <MathText text={item.text} />
                      </div>
                      {item.image && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={`data:image/jpeg;base64,${item.image}`}
                          alt=""
                          className="mt-2 h-20 rounded-[--radius-sm] border border-border-light object-contain"
                        />
                      )}
                    </div>
                  )}
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditingQueueIndex(isEditing ? null : i)}
                      className="rounded-full p-1.5 text-text-muted transition-all hover:bg-primary-bg hover:text-primary"
                      aria-label={isEditing ? "Finish editing problem" : "Edit problem"}
                    >
                      {isEditing ? (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // Adjust the editing index when deleting shifts indices.
                        // - Deleting the edited row: close the editor.
                        // - Deleting a row BEFORE the edited row: shift index down by 1.
                        // - Deleting a row AFTER the edited row: no change.
                        if (editingQueueIndex !== null) {
                          if (editingQueueIndex === i) {
                            setEditingQueueIndex(null);
                          } else if (editingQueueIndex > i) {
                            setEditingQueueIndex(editingQueueIndex - 1);
                          }
                        }
                        removeFromQueue(i);
                      }}
                      className="rounded-full p-1.5 text-text-muted transition-all hover:bg-error-light hover:text-error"
                      aria-label="Remove problem"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}

          {/* Start button — full width */}
          {quotaConfirm ? (
            <div className="space-y-2 rounded-[--radius-md] border border-warning-dark/20 bg-warning-bg p-4">
              <p className="text-sm font-semibold text-warning-dark">
                This will use {problemQueue.length} of your {remainingSessions} remaining problems today.
              </p>
              <div className="flex gap-2">
                <Button gradient onClick={handleStart} loading={isLoading || starting} className="flex-1">
                  Continue
                </Button>
                <Button variant="secondary" onClick={() => setQuotaConfirm(false)} className="flex-1">
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
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
          )}
          {!isPro && remainingSessions < Infinity && !quotaConfirm && (
            <p className="text-center text-xs text-text-muted">
              {remainingSessions} of {FREE_DAILY_SESSION_LIMIT} problems remaining today
            </p>
          )}
        </div>
      )}
      {UpgradeModal}
    </div>
  );
}
