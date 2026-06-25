"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import { useSessionStore, type Subject } from "@/stores/learn";
import { useMockTestStore } from "@/stores/mock-test";
import { useEntitlementStore } from "@/stores/entitlements";
import { Button, Card } from "@/components/ui";
import { PageMasthead } from "@/components/shared/page-masthead";
import { ImageUpload } from "@/components/shared/image-upload";
import { MathText } from "@/components/shared/math-text";
import { EntitlementError } from "@/lib/api";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { cn } from "@/lib/utils";
import { FREE_DAILY_SESSION_LIMIT, FREE_DAILY_SCAN_LIMIT, SUBJECT_CONFIG } from "@/lib/constants";
import { DifficultyPicker, type Difficulty } from "@/components/shared/difficulty-picker";

// Per-subject hue, used only as a thin editorial accent mark — the selector
// surface stays calm cream/green (mirrors the home-page treatment).
const ACCENT: Record<string, string> = {
  math: "#7C3AED",
  physics: "#0984E3",
  chemistry: "#00B894",
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
  const user = useAuthStore((s) => s.user);
  const subject = (searchParams.get("subject") ?? "math") as Subject;
  const sectionId = searchParams.get("section");

  // School-linked students should stay inside class-scoped flows. Belt-
  // and-suspenders with the nav-layer hide in app-layout: blocks direct
  // URL access too.
  useEffect(() => {
    if (user?.role === "student" && user.school_id) {
      router.replace("/school/student");
    }
  }, [user, router]);

  const {
    setSubject,
    setSectionId,
    problemQueue,
    setProblemQueue,
    addToQueue,
    removeFromQueue,
    updateInQueue,
    startLearnQueue,
    startSession,
    phase,
  } = useSessionStore();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const { startMockTest } = useMockTestStore();
  const { isPro, dailySessionsUsed, dailySessionsLimit, dailyScansUsed, dailyScansLimit, fetchEntitlements, incrementScansUsed } = useEntitlementStore();
  const remainingSessions = isPro ? Infinity : Math.max(0, dailySessionsLimit - dailySessionsUsed);
  const remainingScans = isPro ? Infinity : Math.max(0, dailyScansLimit - dailyScansUsed);

  const handleExtractComplete = useCallback(() => {
    incrementScansUsed();
    fetchEntitlements();
  }, [incrementScansUsed, fetchEntitlements]);

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"learn" | "mock-test">("learn");

  // Mock test config
  const [examType, setExamType] = useState<"use_as_exam" | "generate_similar">("use_as_exam");
  const [untimed, setUntimed] = useState(true);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(30);
  const [difficulty, setDifficulty] = useState<Difficulty>("same");
  const [multipleChoice, setMultipleChoice] = useState(true);

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
        await startMockTest(problems, generateCount, timeLimit, subject, problemQueue, multipleChoice, examType === "generate_similar" ? difficulty : "same");
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
    <div className="mx-auto max-w-3xl space-y-10 pb-16">
      <PageMasthead
        eyebrow="LEARN"
        title={
          <>
            What do you want to{" "}
            <span className="text-primary">{isLearn ? "learn" : "test"}</span>?
          </>
        }
        subtitle="Snap a photo, type it out, or paste a whole worksheet — we'll take it one step at a time."
      />

      {/* Subject selector — editorial underline tabs with a thin per-subject accent */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="space-y-3"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
          Subject
        </p>
        <div className="flex flex-wrap items-stretch gap-x-2 gap-y-2 border-b border-border">
          {Object.entries(SUBJECT_CONFIG).map(([key, cfg]) => {
            const isActive = key === subject;
            return (
              <button
                key={key}
                type="button"
                disabled={starting}
                onClick={() => router.push(`/learn?subject=${key}`)}
                className={cn(
                  "group relative -mb-px flex items-center gap-2 px-1 pb-3 pt-1 text-sm font-semibold transition-colors",
                  isActive
                    ? "text-text-primary"
                    : "text-text-muted hover:text-text-secondary",
                  starting && "pointer-events-none opacity-50",
                )}
              >
                <span aria-hidden>{cfg.icon}</span>
                {cfg.name}
                <span
                  className={cn(
                    "absolute inset-x-0 -bottom-px h-[2px] rounded-full transition-opacity",
                    isActive ? "opacity-100" : "opacity-0 group-hover:opacity-30",
                  )}
                  style={{ backgroundColor: ACCENT[key] ?? "#0E5238" }}
                />
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* Mode selector — editorial segmented control, brand-green active */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="relative flex max-w-xs rounded-[--radius-md] border border-border bg-surface p-1"
      >
        {/* Sliding background indicator */}
        <motion.div
          className="absolute inset-y-1 w-[calc(50%-4px)] rounded-[calc(var(--radius-md)-3px)] bg-primary"
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
            disabled={starting}
            onClick={() => setMode(m.id)}
            className={cn(
              "relative z-10 flex-1 rounded-[calc(var(--radius-md)-3px)] py-2 text-sm font-semibold transition-colors",
              mode === m.id ? "text-white" : "text-text-secondary hover:text-text-primary",
              starting && "pointer-events-none",
            )}
          >
            {m.label}
          </button>
        ))}
      </motion.div>

      {/* Mode explainer — quiet helper line so the modes aren't jargon */}
      <motion.p
        key={mode}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="-mt-6 text-sm text-text-muted"
      >
        {isLearn
          ? "A guided, step-by-step walkthrough — we coach you through it."
          : "A timed exam simulation — no hints, graded at the end."}
      </motion.p>

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

            {/* Answer format — inline pill toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-text-muted">Answers:</span>
              <div className="flex rounded-full border border-border bg-surface p-0.5">
                {([
                  { id: true as const, label: "Multiple choice" },
                  { id: false as const, label: "Free response" },
                ]).map((opt) => (
                  <button
                    key={String(opt.id)}
                    onClick={() => setMultipleChoice(opt.id)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                      multipleChoice === opt.id
                        ? "bg-primary text-white"
                        : "text-text-secondary hover:text-text-primary",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </Card>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Snap a photo — calm hairline surface */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="space-y-3 rounded-[--radius-lg] border border-border bg-surface p-6"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
          Snap a problem
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
          onUpgrade={() => showUpgrade("create_session", `You've used ${dailySessionsUsed} of your ${FREE_DAILY_SESSION_LIMIT} problems today. Upgrade to Pro for unlimited access.`)}
          onExtractComplete={handleExtractComplete}
          onPhaseChange={setImagePhase}
        />
      </motion.div>

      {/* Type a problem — calm hairline surface */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="space-y-3 rounded-[--radius-lg] border border-border bg-surface p-6 transition-colors focus-within:border-primary"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
          Type a problem
        </p>
        <div className="flex items-center gap-3">
          <svg className="h-5 w-5 flex-shrink-0 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <input
            type="text"
            placeholder={isScanning ? "Finish scanning first…" : "Or type a problem…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (problemQueue.length > 0) handleAddProblem();
                else handleStart();
              }
            }}
            disabled={isScanning}
            className="flex-1 bg-transparent py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-50"
          />
          {input.trim() && problemQueue.length < maxQueueSize && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAddProblem}
              disabled={isScanning}
            >
              Add
            </Button>
          )}
        </div>
      </motion.div>

      {/* Queued problems — vertical card list */}
      {problemQueue.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            {problemQueue.length} queued
          </p>
          <div className="space-y-2">
            {problemQueue.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-[--radius-md] border border-primary/20 bg-primary-bg/50 px-3 py-2.5"
              >
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {editingIndex === i ? (
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onBlur={() => {
                        if (editText.trim()) updateInQueue(i, editText.trim());
                        setEditingIndex(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (editText.trim()) updateInQueue(i, editText.trim());
                          setEditingIndex(null);
                        }
                        if (e.key === "Escape") setEditingIndex(null);
                      }}
                      autoFocus
                      className="w-full resize-none rounded bg-transparent text-sm text-text-primary outline-none ring-1 ring-primary/40 focus:ring-primary px-2 py-1"
                      rows={2}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setEditingIndex(i); setEditText(item.text); }}
                      className="w-full text-left text-sm leading-relaxed text-text-primary line-clamp-3 hover:text-primary transition-colors"
                      title="Click to edit"
                    >
                      <MathText text={item.text} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    removeFromQueue(i);
                    if (editingIndex === i) setEditingIndex(null);
                    else if (editingIndex !== null && editingIndex > i) setEditingIndex(editingIndex - 1);
                  }}
                  aria-label={`Remove problem ${i + 1}`}
                  className="mt-0.5 flex-shrink-0 rounded-full p-1 text-text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quota confirm */}
      {quotaConfirm && (
        <div className="space-y-2 rounded-[--radius-md] border border-warning-dark/20 bg-warning-bg p-4">
          <p className="text-sm font-semibold text-warning-dark">
            This will use {problemQueue.length} of your {remainingSessions} remaining problems today.
          </p>
          <div className="flex gap-2">
            <Button onClick={handleStart} loading={isLoading || starting} className="flex-1">
              Continue
            </Button>
            <Button variant="secondary" onClick={() => setQuotaConfirm(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Start button — matches mobile labels */}
      {!quotaConfirm && canStart && (
        <Button
          onClick={handleStart}
          loading={isLoading || starting}
          className="w-full py-3 text-base"
        >
          {isLearn
            ? problemQueue.length > 1 ? `Learn (${problemQueue.length})` : "Learn"
            : problemQueue.length > 1 ? `Test (${problemQueue.length})` : "Test"}
        </Button>
      )}

      {!isPro && remainingSessions < Infinity && !quotaConfirm && (
        <p className="text-center text-xs text-text-muted">
          <span className="font-semibold text-text-secondary">{remainingSessions}</span> of{" "}
          {FREE_DAILY_SESSION_LIMIT} problems remaining today
        </p>
      )}
      {UpgradeModal}
    </div>
  );
}
