"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSessionStore, type Subject } from "@/stores/learn";
import { useEntitlementStore } from "@/stores/entitlements";
import { Button } from "@/components/ui";
import { ImageUpload } from "@/components/shared/image-upload";
import { MathText } from "@/components/shared/math-text";
import { EntitlementError } from "@/lib/api";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { cn } from "@/lib/utils";
import { FREE_DAILY_SESSION_LIMIT, FREE_DAILY_SCAN_LIMIT, SUBJECT_CONFIG } from "@/lib/constants";

export default function SolvePage() {
  return (
    <Suspense>
      <SolveContent />
    </Suspense>
  );
}

const SUBJECTS: Subject[] = ["math", "physics", "chemistry"];

function SolveContent() {
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
    removeFromQueue,
    startLearnQueue,
    startSession,
    phase,
  } = useSessionStore();
  const { isPro, dailySessionsUsed, dailySessionsLimit, dailyScansUsed, dailyScansLimit, fetchEntitlements } =
    useEntitlementStore();
  const remainingSessions = isPro ? Infinity : Math.max(0, dailySessionsLimit - dailySessionsUsed);
  const remainingScans = isPro ? Infinity : Math.max(0, dailyScansLimit - dailyScansUsed);
  const maxQueueSize = isPro ? 10 : Math.min(10, remainingSessions);

  const [input, setInput] = useState("");
  const [starting, setStarting] = useState(false);
  const [quotaConfirm, setQuotaConfirm] = useState(false);
  const [subjectMenuOpen, setSubjectMenuOpen] = useState(false);
  const [imagePhase, setImagePhase] = useState<"upload" | "select" | "extracting">("upload");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { showUpgrade, UpgradeModal } = useUpgradePrompt();

  useEffect(() => {
    setSubject(subject);
    setSectionId(sectionId);
    document.documentElement.setAttribute("data-subject", subject);
    setProblemQueue([]);
    fetchEntitlements();
    return () => document.documentElement.removeAttribute("data-subject");
  }, [subject, sectionId, setSubject, setSectionId, setProblemQueue, fetchEntitlements]);

  const isScanning = imagePhase === "select" || imagePhase === "extracting";
  const totalProblems = problemQueue.length + (input.trim() ? 1 : 0);
  const isLoading = phase === "loading" || starting;
  const config = SUBJECT_CONFIG[subject];

  function handleAddProblem() {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!isPro && problemQueue.length >= maxQueueSize) {
      const msg = problemQueue.length > 0
        ? `Your queue is full — you have ${remainingSessions} problem${remainingSessions !== 1 ? "s" : ""} remaining today.`
        : `You've used all ${FREE_DAILY_SESSION_LIMIT} problems for today. Upgrade to Pro for unlimited access.`;
      showUpgrade("create_session", msg);
      return;
    }
    addToQueue(trimmed);
    setInput("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (problemQueue.length > 0) handleAddProblem();
      else handleSolve();
    }
  }

  async function handleSolve() {
    if (starting) return;
    if (problemQueue.length === 0 && !input.trim()) return;
    if (!isPro && remainingSessions <= 0) {
      showUpgrade(
        "create_session",
        `You've used all ${FREE_DAILY_SESSION_LIMIT} problems for today. Upgrade to Pro for unlimited access.`,
      );
      return;
    }

    const problemCount = problemQueue.length > 0 ? problemQueue.length + (input.trim() ? 1 : 0) : 1;
    if (!isPro && problemCount > 1 && !quotaConfirm) {
      setQuotaConfirm(true);
      return;
    }
    setQuotaConfirm(false);
    setStarting(true);

    const allProblems =
      problemQueue.length > 0
        ? [...problemQueue.map((p) => p.text), ...(input.trim() ? [input.trim()] : [])]
        : [input.trim()];
    const firstImage = problemQueue.length > 0 ? problemQueue[0].image : undefined;

    try {
      if (allProblems.length === 1) {
        await startSession(allProblems[0], firstImage);
      } else {
        await startLearnQueue(allProblems);
      }
      router.push(`/learn/session?subject=${subject}`);
    } catch (err) {
      if (err instanceof EntitlementError) {
        showUpgrade(err.entitlement, err.message);
      }
      setStarting(false);
    }
  }

  function pickSubject(s: Subject) {
    setSubjectMenuOpen(false);
    if (s === subject) return;
    router.push(`/learn?subject=${s}`);
  }

  const solveLabel =
    totalProblems === 0
      ? "Solve"
      : totalProblems === 1
        ? "Solve"
        : `Solve ${totalProblems} problems`;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-2xl flex-col">
      {/* Top: subject pill */}
      <div className="mb-6 flex items-center justify-between">
        <div className="relative">
          <button
            type="button"
            onClick={() => setSubjectMenuOpen((o) => !o)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full bg-gradient-to-r px-4 py-2 text-sm font-bold text-white shadow-md",
              config?.gradient ?? "from-primary to-primary-light",
            )}
            aria-haspopup="listbox"
            aria-expanded={subjectMenuOpen}
            aria-label={`Subject: ${config?.name ?? subject}. Click to change.`}
          >
            <span>{config?.icon}</span>
            <span>{config?.name ?? subject}</span>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {subjectMenuOpen && (
            <div
              className="absolute left-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-[--radius-md] border border-border-light bg-surface shadow-lg"
              role="listbox"
            >
              {SUBJECTS.map((s) => {
                const sc = SUBJECT_CONFIG[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => pickSubject(s)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold transition-colors hover:bg-primary-bg",
                      s === subject ? "bg-primary-bg text-primary" : "text-text-primary",
                    )}
                    role="option"
                    aria-selected={s === subject}
                  >
                    <span>{sc?.icon}</span>
                    <span>{sc?.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Hero */}
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">
          What can I help you<br />solve today?
        </h1>
      </div>

      {/* Big snap target — wraps ImageUpload */}
      <div className="mb-4">
        <ImageUpload
          subject={subject}
          onProblemsExtracted={(problems) => {
            problems.forEach((p) => addToQueue(p.text, p.image));
          }}
          maxProblems={maxQueueSize}
          currentQueueLength={problemQueue.length}
          scansRemaining={remainingScans}
          onScanLimitReached={() =>
            showUpgrade(
              "image_scan",
              `You've used all ${FREE_DAILY_SCAN_LIMIT} image scans for today. Upgrade to Pro for unlimited scans.`,
            )
          }
          onExtractComplete={fetchEntitlements}
          onPhaseChange={setImagePhase}
        />
      </div>

      {/* Inline text input */}
      <div className="mb-3">
        <div className="flex items-stretch gap-2 rounded-[--radius-lg] border-2 border-border bg-surface focus-within:border-primary">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isScanning ? "Finish scanning first…" : "…or type a problem here"}
            disabled={isScanning}
            rows={1}
            className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            aria-label="Type a math problem"
          />
          {input.trim() && problemQueue.length < maxQueueSize && (
            <button
              type="button"
              onClick={handleAddProblem}
              className="m-2 flex h-8 w-8 flex-shrink-0 items-center justify-center self-end rounded-full bg-primary text-white shadow-sm hover:bg-primary-dark"
              aria-label="Add to queue"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Inline queue chips */}
      {problemQueue.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">
            {problemQueue.length} queued
          </p>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {problemQueue.map((item, i) => (
              <div
                key={i}
                className="flex flex-shrink-0 items-center gap-2 rounded-full bg-primary-bg px-3 py-1.5 text-xs font-semibold text-primary"
              >
                <span className="max-w-[180px] truncate">
                  <MathText text={item.text} />
                </span>
                <button
                  type="button"
                  onClick={() => removeFromQueue(i)}
                  aria-label={`Remove problem ${i + 1}`}
                  className="rounded-full p-0.5 text-primary/70 hover:bg-primary/10 hover:text-primary"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quota confirm inline */}
      {quotaConfirm && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[--radius-md] border-l-4 border-warning-dark bg-warning-bg p-3">
          <p className="flex-1 text-sm text-text-primary">
            This will use {totalProblems} of your {remainingSessions} remaining problems today.
          </p>
          <button
            type="button"
            onClick={() => setQuotaConfirm(false)}
            className="text-xs font-semibold text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Spacer pushes solve button to bottom */}
      <div className="flex-1" />

      {/* Sticky-feel solve button */}
      <div className="sticky bottom-20 mt-6 -mx-4 border-t border-border-light bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 md:-mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0">
        <Button
          gradient
          onClick={handleSolve}
          loading={isLoading}
          disabled={totalProblems === 0}
          className="w-full py-3 text-base"
          aria-label={solveLabel}
        >
          {solveLabel}
        </Button>
        {!isPro && remainingSessions < Infinity && (
          <p className="mt-2 text-center text-xs text-text-muted">
            {remainingSessions} of {FREE_DAILY_SESSION_LIMIT} problems left today
          </p>
        )}
      </div>

      {UpgradeModal}
    </div>
  );
}
