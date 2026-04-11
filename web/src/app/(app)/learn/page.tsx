"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore, type Subject } from "@/stores/learn";
import { useMockTestStore } from "@/stores/mock-test";
import { useEntitlementStore } from "@/stores/entitlements";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { useImageExtraction } from "@/hooks/use-image-extraction";
import { EntitlementError } from "@/lib/api";
import { FREE_DAILY_SESSION_LIMIT, FREE_DAILY_SCAN_LIMIT, SUBJECT_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui";
import { SubjectPills } from "@/components/shared/subject-pills";
import { MockTestConfig, type ExamType } from "@/components/shared/mock-test-config";
import { ExtractionResultModal } from "@/components/shared/extraction-result-modal";
import { MathText } from "@/components/shared/math-text";
import { RectangleSelector } from "@/components/shared/rectangle-selector";
import { cn } from "@/lib/utils";

const MAX_PROBLEMS = 10;
type Mode = "learn" | "mock_test";

export default function SolvePage() {
  return (
    <Suspense>
      <SolveContent />
    </Suspense>
  );
}

function SolveContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlSubject = (searchParams.get("subject") ?? "math") as Subject;
  const sectionId = searchParams.get("section");

  const {
    subject,
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
  const startMockTest = useMockTestStore((s) => s.startMockTest);

  const {
    isPro,
    dailySessionsUsed,
    dailySessionsLimit,
    dailyScansUsed,
    dailyScansLimit,
    fetchEntitlements,
  } = useEntitlementStore();

  const remainingSessions = isPro ? Infinity : Math.max(0, dailySessionsLimit - dailySessionsUsed);
  const remainingScans = isPro ? Infinity : Math.max(0, dailyScansLimit - dailyScansUsed);
  const maxQueueSize = isPro ? MAX_PROBLEMS : Math.min(MAX_PROBLEMS, remainingSessions);

  const [mode, setMode] = useState<Mode>("learn");
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [quotaConfirm, setQuotaConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mock Test config
  const [examType, setExamType] = useState<ExamType>("use_as_exam");
  const [untimed, setUntimed] = useState(true);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(30);
  const [multipleChoice, setMultipleChoice] = useState(true);

  const { showUpgrade, UpgradeModal } = useUpgradePrompt();

  // Destructure the extraction hook so ESLint's react-hooks/refs rule
  // doesn't false-positive on the render-time property reads.
  const {
    phase: extractionPhase,
    imageBase64: extractionImage,
    result: extractionResult,
    selected: extractionSelected,
    progress: extractionProgress,
    error: extractionError,
    editingIndex: extractionEditingIndex,
    pickFromCamera,
    pickFromGallery,
    extractRectangles,
    cancelSelect,
    toggleSelected,
    updateProblemText,
    setEditingIndex,
    getConfirmedItems,
    closeResult,
    cameraInputRef,
    galleryInputRef,
    onCameraChange,
    onGalleryChange,
  } = useImageExtraction({
    subject: urlSubject,
    maxItems: maxQueueSize,
    scansRemaining: remainingScans,
    onScanLimitReached: () =>
      showUpgrade(
        "image_scan",
        `You've used all ${FREE_DAILY_SCAN_LIMIT} image scans for today. Upgrade to Pro for unlimited scans.`,
      ),
    onExtractComplete: fetchEntitlements,
  });

  // Sync URL subject → store on mount / subject change.
  // data-subject is applied automatically by <SubjectTheme /> in (app)/layout.
  useEffect(() => {
    setSubject(urlSubject);
    setSectionId(sectionId);
    setProblemQueue([]);
    fetchEntitlements();
  }, [urlSubject, sectionId, setSubject, setSectionId, setProblemQueue, fetchEntitlements]);

  const totalProblems = problemQueue.length + (input.trim() ? 1 : 0);
  const isLoading = phase === "loading" || starting;
  const extracting = extractionPhase === "extracting";

  // Queue label adapts to mode + examType
  const queueLabel = (() => {
    const n = problemQueue.length;
    if (mode === "mock_test") {
      if (examType === "generate_similar") {
        return `${n} example${n !== 1 ? "s" : ""} → ${n} generated question${n !== 1 ? "s" : ""}`;
      }
      return `${n} question${n !== 1 ? "s" : ""}`;
    }
    return `${n} ${n === 1 ? "problem" : "problems"} queued`;
  })();

  // Solve button label
  const solveLabel = (() => {
    const verb = mode === "mock_test" ? "Test" : "Learn";
    if (totalProblems <= 1) return verb;
    return `${verb} (${totalProblems})`;
  })();

  function onSubjectChange(next: Subject) {
    if (next === urlSubject) return;
    router.push(`/learn?subject=${next}${sectionId ? `&section=${sectionId}` : ""}`);
  }

  function handleAddFromTyping() {
    const text = input.trim();
    if (!text) {
      setTyping(false);
      return;
    }
    if (!isPro && problemQueue.length >= maxQueueSize) {
      const msg =
        problemQueue.length > 0
          ? `Your queue is full — you have ${remainingSessions} problem${remainingSessions !== 1 ? "s" : ""} remaining today.`
          : `You've used all ${FREE_DAILY_SESSION_LIMIT} problems for today. Upgrade to Pro for unlimited access.`;
      showUpgrade("create_session", msg);
      return;
    }
    addToQueue(text);
    setInput("");
    setError(null);
    setTyping(false);
  }

  function handleConfirmExtraction() {
    const remaining = maxQueueSize - problemQueue.length;
    const items = getConfirmedItems(remaining);
    items.forEach((it) => addToQueue(it.text, it.image));
    closeResult();
  }

  async function handleSolve() {
    if (starting) return;
    const queueTexts = problemQueue.map((p) => p.text);
    const allProblems =
      queueTexts.length > 0
        ? [...queueTexts, ...(input.trim() ? [input.trim()] : [])]
        : input.trim()
          ? [input.trim()]
          : [];
    if (allProblems.length === 0) return;

    setError(null);

    if (!isPro && remainingSessions <= 0) {
      showUpgrade(
        "create_session",
        `You've used all ${FREE_DAILY_SESSION_LIMIT} problems for today. Upgrade to Pro for unlimited access.`,
      );
      return;
    }
    if (!isPro && allProblems.length > 1 && !quotaConfirm) {
      setQuotaConfirm(true);
      return;
    }
    setQuotaConfirm(false);
    setStarting(true);

    try {
      if (mode === "mock_test") {
        const generateCount = examType === "generate_similar" ? allProblems.length : 0;
        const timeLimit = untimed ? null : timeLimitMinutes;
        await startMockTest(
          allProblems,
          generateCount,
          timeLimit,
          urlSubject,
          problemQueue,
          multipleChoice,
        );
        setProblemQueue([]);
        setInput("");
        router.push(`/mock-test?subject=${urlSubject}`);
      } else {
        const firstImage = problemQueue[0]?.image;
        if (allProblems.length === 1) {
          await startSession(allProblems[0], firstImage);
        } else {
          await startLearnQueue(allProblems);
        }
        router.push(`/learn/session?subject=${urlSubject}`);
      }
    } catch (err) {
      if (err instanceof EntitlementError) {
        showUpgrade(err.entitlement, err.message);
      } else {
        setError((err as Error).message);
      }
      setStarting(false);
    }
  }

  // ── Rectangle selection phase (manual crop fallback) ──
  if (extractionPhase === "select" && extractionImage) {
    return (
      <RectangleSelector
        imageBase64={extractionImage}
        onConfirm={extractRectangles}
        onCancel={cancelSelect}
        maxRectangles={Math.min(10, maxQueueSize - problemQueue.length, remainingScans)}
      />
    );
  }

  const cardsDisabled = extracting || problemQueue.length >= maxQueueSize;
  const activeGradient = SUBJECT_CONFIG[urlSubject]?.gradient ?? "bg-gradient-primary";

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-2xl flex-col">
      {/* Subject pills row */}
      <SubjectPills active={subject} onChange={onSubjectChange} />

      {/* Mode segmented control */}
      <div className="flex gap-2 px-5 pb-3">
        <ModePill
          label="Learn"
          icon={<BookIcon />}
          active={mode === "learn"}
          onClick={() => setMode("learn")}
        />
        <ModePill
          label="Mock Test"
          icon={<DocIcon />}
          active={mode === "mock_test"}
          onClick={() => setMode("mock_test")}
        />
      </div>

      {/* Scroll region */}
      <div className="flex-1 px-5 pb-4">
        {/* Hero greeting */}
        <motion.h1
          key={mode}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mb-5 text-[30px] font-extrabold leading-tight tracking-tight text-text-primary"
        >
          {mode === "mock_test" ? "What can I help you test?" : "What can I help you learn?"}
        </motion.h1>

        {/* Snap card (gradient) */}
        <HeroCard
          variant="gradient"
          gradientClass={activeGradient}
          disabled={cardsDisabled}
          onClick={pickFromCamera}
          icon={<CameraIcon className="h-8 w-8 text-white" />}
          title="Snap a problem"
          subtitle="Point your camera at any problem"
          ariaLabel="Snap a photo of a problem"
        />

        {/* Gallery card (outlined) */}
        <HeroCard
          variant="outlined"
          disabled={cardsDisabled}
          onClick={pickFromGallery}
          icon={<ImagesIcon className="h-8 w-8 text-primary" />}
          title="Choose a photo"
          subtitle="Pick a problem from your device"
          ariaLabel="Choose a photo from your device"
        />

        {/* Type card (outlined, collapses to inline input) */}
        <div
          className={cn(
            "mb-3 flex min-h-[180px] flex-col items-center justify-center rounded-[--radius-lg] border-2 border-primary bg-surface px-5 py-8 shadow-sm transition-opacity",
            cardsDisabled && !typing && "opacity-50",
          )}
          onClick={() => {
            if (!typing && !cardsDisabled) {
              setTyping(true);
              requestAnimationFrame(() => inputRef.current?.focus());
            }
          }}
          role={typing ? undefined : "button"}
          tabIndex={typing ? -1 : 0}
          onKeyDown={(e) => {
            if (!typing && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              setTyping(true);
              requestAnimationFrame(() => inputRef.current?.focus());
            }
          }}
          aria-label={typing ? undefined : "Type a problem"}
        >
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary-bg">
            <EditIcon className="h-8 w-8 text-primary" />
          </div>
          {typing ? (
            <div className="flex w-full items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddFromTyping();
                  }
                }}
                onBlur={() => {
                  if (!input.trim()) setTyping(false);
                }}
                placeholder="Type your problem here…"
                className="flex-1 bg-transparent text-center text-base font-semibold text-primary placeholder:text-text-muted focus:outline-none"
                aria-label="Problem text input"
              />
              {input.trim() ? (
                <button
                  type="button"
                  onClick={handleAddFromTyping}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white transition-transform active:scale-95"
                  aria-label="Add to queue"
                >
                  <CheckIcon className="h-5 w-5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setTyping(false)}
                  className="rounded-[--radius-pill] bg-border px-3 py-2 text-xs font-semibold text-text-secondary"
                >
                  Done
                </button>
              )}
            </div>
          ) : (
            <>
              <h3 className="mb-1 text-2xl font-bold text-primary">Type a problem</h3>
              <p className="text-[13px] text-text-secondary">Tap to enter your problem here</p>
            </>
          )}
        </div>

        {/* Queue chips */}
        {problemQueue.length > 0 && (
          <div className="mb-3">
            <p className="mb-2 text-[13px] font-semibold text-primary">{queueLabel}</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {problemQueue.map((item, i) => (
                <div
                  key={`${i}-${item.text}`}
                  className="flex max-w-[220px] flex-shrink-0 items-center gap-2 rounded-[--radius-pill] bg-primary-bg px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-primary">
                    <MathText text={item.text} />
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFromQueue(i)}
                    aria-label={`Remove problem ${i + 1}`}
                    // -m-1 p-1 expands the 16x16 icon hit area to ~24px
                    // without changing visual layout
                    className="-m-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full p-1 text-text-muted hover:text-text-secondary"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mock Test config (only in mock mode) */}
        {mode === "mock_test" && (
          <div className="mt-4">
            <MockTestConfig
              examType={examType}
              onExamTypeChange={setExamType}
              untimed={untimed}
              onUntimedChange={setUntimed}
              timeLimitMinutes={timeLimitMinutes}
              onTimeLimitChange={setTimeLimitMinutes}
              multipleChoice={multipleChoice}
              onMultipleChoiceChange={setMultipleChoice}
            />
          </div>
        )}

        {/* Extracting indicator */}
        {extracting && (
          <div className="mb-3 flex items-center gap-3 rounded-[--radius-lg] bg-surface p-4 shadow-sm">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="flex-1 text-sm text-text-secondary">
              {extractionProgress.total > 1
                ? `Reading ${Math.min(extractionProgress.done + 1, extractionProgress.total)} of ${extractionProgress.total}…`
                : "Reading your problem…"}
            </p>
          </div>
        )}

        {/* Quota confirm inline */}
        {quotaConfirm && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[--radius-lg] border-l-4 border-warning-dark bg-warning-bg p-3">
            <svg className="h-5 w-5 flex-shrink-0 text-warning-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="flex-1 text-[13px] text-text-primary">
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

        {/* Inline error */}
        {(error ?? extractionError) && (
          <div className="mb-3 flex items-center gap-2 text-xs text-error">
            <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="flex-1">{error ?? extractionError}</span>
          </div>
        )}

        {/* Quota footer */}
        {!isPro && remainingSessions < Infinity && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-border-light">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.min(
                    ((dailySessionsLimit - remainingSessions) / dailySessionsLimit) * 100,
                    100,
                  )}%`,
                }}
              />
            </div>
            <p className="text-xs text-text-muted">
              {remainingSessions} of {dailySessionsLimit} left today
            </p>
          </div>
        )}
      </div>

      {/* Sticky bottom action bar */}
      <div className="sticky bottom-16 border-t border-border-light bg-background/95 px-5 py-3 backdrop-blur md:static md:bottom-0 md:border-0 md:bg-transparent md:px-0 md:py-4">
        <Button
          gradient
          onClick={handleSolve}
          loading={isLoading}
          disabled={totalProblems === 0}
          className="w-full"
          aria-label={solveLabel}
        >
          {solveLabel}
        </Button>
      </div>

      {/* Hidden file inputs — camera uses `capture` so phones open the camera */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onCameraChange}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={onGalleryChange}
        className="hidden"
      />

      {/* Extraction results modal */}
      <ExtractionResultModal
        result={extractionResult}
        selected={extractionSelected}
        editingIndex={extractionEditingIndex}
        onToggle={toggleSelected}
        onUpdateText={updateProblemText}
        onSetEditingIndex={setEditingIndex}
        onConfirm={handleConfirmExtraction}
        onClose={closeResult}
      />

      {UpgradeModal}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Subcomponents
// ═══════════════════════════════════════════════════════════════════

function ModePill({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // min-h-10 (40px) is close enough to 44px for small segmented pills
        // because they're not the primary action — and matches mobile sizing
        "inline-flex min-h-10 items-center gap-1.5 rounded-[--radius-pill] px-4 py-2 text-[13px] font-semibold transition-colors",
        active
          ? "border border-primary bg-primary-bg text-primary"
          : "bg-input-bg text-text-muted hover:text-text-secondary",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function HeroCard({
  variant,
  gradientClass,
  disabled,
  onClick,
  icon,
  title,
  subtitle,
  ariaLabel,
}: {
  variant: "gradient" | "outlined";
  gradientClass?: string;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  ariaLabel: string;
}) {
  const gradient = variant === "gradient";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      whileTap={{ scale: disabled ? 1 : 0.97 }}
      className={cn(
        "mb-3 flex min-h-[180px] w-full flex-col items-center justify-center rounded-[--radius-lg] px-5 py-8 text-center shadow-lg transition-opacity",
        gradient ? gradientClass : "border-2 border-primary bg-surface shadow-sm",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <div
        className={cn(
          "mb-3 flex h-14 w-14 items-center justify-center rounded-full",
          gradient ? "bg-white/20" : "bg-primary-bg",
        )}
      >
        {icon}
      </div>
      <h3
        className={cn(
          "mb-1 text-2xl font-bold",
          gradient ? "text-white" : "text-primary",
        )}
      >
        {title}
      </h3>
      <p
        className={cn(
          "text-[13px]",
          gradient ? "text-white/85" : "text-text-secondary",
        )}
      >
        {subtitle}
      </p>
    </motion.button>
  );
}

// ── Icons ──

function BookIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function ImagesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
