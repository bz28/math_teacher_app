"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  schoolStudent,
  type IntegrityExtraction,
  type IntegrityProblemSummary,
  type IntegrityStateResponse,
  type IntegrityTurn,
} from "@/lib/api";
import { ExtractionView } from "@/components/school/shared/extraction-view";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";
import { useDeviceType } from "./use-device-type";
import { useTurnTelemetry } from "./use-turn-telemetry";

// Soft time budget we advertise to the student on the chat header.
// Mobile typing is ~2x slower than desktop, so mobile students see a
// longer budget — the check doesn't cut anyone off at the displayed
// number, it's just a "about this long" hint to set expectations.
const BUDGET_LABEL: Record<"desktop" | "mobile", string> = {
  desktop: "~3 min",
  mobile: "~5 min",
};

// Inactivity thresholds. After this long without typing / pasting /
// sending, show a gentle "still there?" banner + "I need more time"
// option. Mobile typers get a longer window. Tapping "I need more
// time" doubles it for the rest of the session. Never cuts the
// student off — server-side turn caps are independent of this.
const INACTIVITY_NUDGE_MS: Record<"desktop" | "mobile", number> = {
  desktop: 120_000,
  mobile: 180_000,
};
// How often the check runs. Doesn't need to be precise — the nudge
// just needs to appear "about 2 min" after last activity.
const INACTIVITY_TICK_MS = 5_000;

interface Props {
  submissionId: string;
  /** The HW this check is gated on. Used to look up a linked
   *  practice set so the terminal panel can nudge the student
   *  there when disposition ∈ {needs_practice, tutor_pivot}. */
  assignmentId: string;
  /** The course the HW belongs to. Only used to build the target
   *  URL for the Go-to-Practice CTA. */
  courseId: string;
  /** Called when the chat reaches the done state OR the kid taps
   *  Exit. The parent re-fetches state on close. */
  onDone: () => void;
}

const MIN_MESSAGE_CHARS = 5;

/**
 * Kid-facing conversational integrity chat.
 *
 * On mount we hydrate the full transcript from the server (so a kid
 * who closes the tab mid-conversation comes back right where they
 * left off). On send, we append an optimistic student turn, POST to
 * /turn, and replace local state with the server response — which
 * includes both the student turn (canonical) and the agent's reply.
 *
 * No visible turn counter. A thin progress bar at the top reflects
 * how many sampled problems have been verdicted.
 */
export function IntegrityCheckChat({
  submissionId,
  assignmentId,
  courseId,
  onDone,
}: Props) {
  const [state, setState] = useState<IntegrityStateResponse | null>(null);
  const [pendingStudentMessage, setPendingStudentMessage] =
    useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnStartedAt, setTurnStartedAt] = useState<number>(Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const telemetry = useTurnTelemetry();
  const device = useDeviceType();
  const lastActivityRef = useRef<number>(Date.now());
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const [timeoutDoubled, setTimeoutDoubled] = useState(false);
  // Reference panel: collapsed by default so the chat feels focused.
  // When the agent is asking about a specific step, the student can
  // expand to see the original problem + their extracted work.
  const [referenceOpen, setReferenceOpen] = useState(false);
  // Practice set linked to this HW, if any. Used by the terminal
  // "Go to Practice" CTA — silent when null (no nudge rendered).
  // Looked up on mount rather than at render time so a momentary
  // publish by the teacher while the student is mid-chat picks up
  // the link without requiring a manual refresh.
  const [linkedPracticeId, setLinkedPracticeId] = useState<string | null>(null);

  // Hydrate the transcript on mount.
  useEffect(() => {
    let cancelled = false;
    schoolStudent
      .getIntegrityState(submissionId)
      .then((s) => {
        if (!cancelled) {
          setState(s);
          setTurnStartedAt(Date.now());
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the check. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  // Look up any practice set linked to this HW on mount. Non-fatal
  // on failure — if the lookup errors we just skip the CTA.
  useEffect(() => {
    let cancelled = false;
    schoolStudent
      .linkedPracticeForHomework(assignmentId)
      .then((r) => {
        if (!cancelled) setLinkedPracticeId(r.practice_assignment_id);
      })
      .catch(() => {
        /* silent — absence of CTA is the safe default */
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  // Auto-scroll to the newest turn whenever the transcript grows.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state?.transcript.length, pendingStudentMessage]);

  const problemsVerdicted = useMemo(() => {
    if (!state) return 0;
    return state.problems.filter(
      (p) => p.status === "verdict_submitted" || p.status === "dismissed",
    ).length;
  }, [state]);

  const totalProblems = state?.problems.length ?? 0;
  const isComplete =
    state?.overall_status === "complete" ||
    state?.overall_status === "skipped_unreadable";

  // Inactivity nudge: show a gentle "still there?" + "I need more
  // time" banner if the student goes quiet. Any activity (keystroke,
  // paste, send, focus return) resets the timer via markActivity().
  // Skip while sending (they're waiting, not idle), when the check
  // is complete, or when the student already tapped "I need more
  // time" — at that point we've extended their window and trust
  // them, no more nudges.
  const nudgeTimeoutMs =
    INACTIVITY_NUDGE_MS[device] * (timeoutDoubled ? 2 : 1);
  useEffect(() => {
    if (isComplete || timeoutDoubled) return;
    const interval = window.setInterval(() => {
      if (sending) return;
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= nudgeTimeoutMs) {
        setNudgeVisible(true);
      }
    }, INACTIVITY_TICK_MS);
    return () => window.clearInterval(interval);
  }, [isComplete, sending, nudgeTimeoutMs, timeoutDoubled]);

  // Any activity resets the timer and dismisses the nudge if it's up.
  const markActivity = () => {
    lastActivityRef.current = Date.now();
    if (nudgeVisible) setNudgeVisible(false);
  };

  const handleNeedMoreTime = () => {
    setTimeoutDoubled(true);
    telemetry.markNeedMoreTime();
    markActivity();
  };

  const visibleTranscript: IntegrityTurn[] = useMemo(() => {
    const base = state?.transcript ?? [];
    if (!pendingStudentMessage) return base;
    // Optimistic student turn — gets replaced when the server response
    // lands (server transcript includes the real row).
    return [
      ...base,
      {
        ordinal: base.length,
        role: "student",
        content: pendingStudentMessage,
        created_at: new Date().toISOString(),
      },
    ];
  }, [state, pendingStudentMessage]);

  async function handleSend() {
    const trimmed = message.trim();
    if (trimmed.length < MIN_MESSAGE_CHARS || sending || isComplete) return;
    setPendingStudentMessage(trimmed);
    setMessage("");
    setSending(true);
    setError(null);
    try {
      const seconds = Math.max(
        0,
        Math.round((Date.now() - turnStartedAt) / 1000),
      );
      const telemetryPayload = telemetry.snapshot();
      const next = await schoolStudent.postIntegrityTurn(submissionId, {
        message: trimmed,
        seconds_on_turn: seconds,
        telemetry: telemetryPayload,
      });
      // Only reset telemetry after the turn is persisted on the
      // server; a failed POST keeps the signals intact for retry.
      telemetry.reset();
      setState(next);
      setPendingStudentMessage(null);
      setTurnStartedAt(Date.now());
      // The agent's reply counts as "fresh activity" — resetting
      // here stops the inactivity nudge from firing immediately on
      // a turn that finished right at the threshold.
      lastActivityRef.current = Date.now();
    } catch {
      setError("Couldn't send that — try again.");
      setPendingStudentMessage(null);
      setMessage(trimmed);
    } finally {
      setSending(false);
    }
  }

  if (state === null && error === null) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center text-text-muted">
        Loading…
      </div>
    );
  }

  if (state === null) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <p className="text-error">{error}</p>
        <button
          onClick={onDone}
          className="mt-4 rounded-[--radius-sm] border border-border px-4 py-2 text-sm hover:border-primary"
        >
          Back to homework
        </button>
      </div>
    );
  }

  const canSend =
    !sending && !isComplete && message.trim().length >= MIN_MESSAGE_CHARS;

  const hasReference = state && state.problems.length > 0;

  return (
    // Outer wrapper holds both columns at full viewport height. On
    // mobile (default) only the chat column renders, capped at
    // max-w-2xl and centered — same UX as before. On md+ a 320px
    // reference column sits to the left, always visible, so the
    // student can read the problem and their extracted work side-by-
    // side with the chat instead of toggling a panel up and down.
    <div className="mx-auto h-[calc(100dvh-4rem)] w-full max-w-5xl">
      <div
        className={cn(
          "grid h-full",
          hasReference && "md:grid-cols-[320px_1fr]",
        )}
      >
        {hasReference && (
          <aside
            aria-label="Reference: problem and your submitted work"
            className="hidden h-full flex-col overflow-hidden border-r border-border-light bg-bg-subtle/40 md:flex"
          >
            <div className="flex items-center justify-between border-b border-border-light px-3 py-3">
              <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
                Reference
              </div>
              <div className="text-[10px] text-text-muted">
                Problem &amp; your work
              </div>
            </div>
            {/* tabIndex/role/aria-label on the inner scroller mirror
             *  the mobile collapsible — a keyboard user lands on this
             *  region with Tab and can scroll it with arrow keys.
             *  The outer <aside> is a landmark; this inner div is
             *  the focusable scroll container. */}
            <div
              role="region"
              aria-label="Problem and your submitted work"
              tabIndex={0}
              className="flex-1 overflow-y-auto px-3 py-3"
            >
              <ReferencePanel
                problems={state.problems}
                extraction={state.extraction}
              />
            </div>
          </aside>
        )}

        <div className="mx-auto flex h-full w-full max-w-2xl flex-col md:mx-0 md:max-w-none">
          <div className="flex items-center justify-between border-b border-border-light px-2 py-3">
            <div className="flex items-baseline gap-2">
              <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
                Quick understanding check
              </div>
              {!isComplete && (
                <div className="text-[11px] font-medium text-text-muted">
                  · {BUDGET_LABEL[device]}
                </div>
              )}
            </div>
            {totalProblems > 0 && (
              <div className="text-xs font-medium text-text-muted">
                {problemsVerdicted} of {totalProblems}
              </div>
            )}
          </div>
          {totalProblems > 0 && (
            <div className="h-1 w-full bg-border-light">
              <div
                className="h-1 bg-primary transition-all"
                style={{
                  width: `${
                    totalProblems === 0
                      ? 0
                      : (problemsVerdicted / totalProblems) * 100
                  }%`,
                }}
              />
            </div>
          )}

          {/* Mobile-only reference toggle. md+ surfaces the same
              content as a sticky left column instead, so this
              collapsible exists purely for the narrow viewport where
              a side panel would crowd the chat. */}
          {hasReference && (
            <div className="border-b border-border-light px-2 md:hidden">
              <button
                type="button"
                onClick={() => setReferenceOpen((v) => !v)}
                aria-expanded={referenceOpen}
                aria-controls="integrity-chat-reference-panel"
                className="flex w-full items-center gap-2 py-2 text-xs font-semibold text-text-secondary hover:text-primary"
              >
                <span className="text-[10px]" aria-hidden>
                  {referenceOpen ? "▼" : "▶"}
                </span>
                {referenceOpen ? "Hide problem & work" : "Show problem & work"}
              </button>
              {referenceOpen && (
                <div
                  id="integrity-chat-reference-panel"
                  role="region"
                  aria-label="Problem and your submitted work"
                  tabIndex={0}
                  className="max-h-[40dvh] overflow-y-auto pb-3"
                >
                  <ReferencePanel
                    problems={state.problems}
                    extraction={state.extraction}
                  />
                </div>
              )}
            </div>
          )}

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-2 py-4"
      >
        {visibleTranscript.map((t) => (
          <TurnBubble key={`${t.ordinal}-${t.role}`} turn={t} />
        ))}
        {/* Animated "AI is thinking" indicator shown while we're
            waiting on the /turn round-trip. Appears right after the
            optimistic student message so the chat flow reads
            student → thinking → agent reply. Matches the pattern
            used in the teacher workshop agent. */}
        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-[--radius-md] border border-border bg-surface px-3 py-2 text-xs italic text-text-muted">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
              </span>
              AI is thinking…
            </div>
          </div>
        )}
      </div>

      {isComplete ? (
        <div className="border-t border-border-light px-2 py-4 text-center">
          <div className="text-sm text-text-secondary">
            Thanks — your work is with your teacher.
          </div>
          {/* Practice nudge — only renders when the agent's disposition
              suggests more study would help AND a practice set is
              actually linked to this HW. Any other combination stays
              silent so the terminal matches what was there before. */}
          <PracticeNudge
            disposition={state?.disposition ?? null}
            courseId={courseId}
            linkedPracticeId={linkedPracticeId}
          />
          <button
            onClick={onDone}
            className="mt-3 rounded-[--radius-sm] bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary/90"
          >
            Back to homework
          </button>
        </div>
      ) : (
        <div className="border-t border-border-light px-2 py-3">
          {nudgeVisible && !timeoutDoubled && (
            <div
              role="status"
              aria-live="polite"
              className="mb-2 flex items-center justify-between gap-2 rounded-[--radius-sm] border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <span>Still there? Take your time.</span>
              <button
                type="button"
                onClick={handleNeedMoreTime}
                className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800 hover:bg-amber-200 dark:bg-amber-800/40 dark:text-amber-100"
              >
                I need more time
              </button>
            </div>
          )}
          {error && <p className="mb-2 text-xs text-error">{error}</p>}
          <div className="flex items-end gap-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                // Activity resets on ANY keydown — CJK IME composition
                // keystrokes, Shift+Arrow text selection, and Cmd/Ctrl
                // shortcuts all count as "student is engaged" even
                // though they don't count as typing for the cadence
                // signal.
                markActivity();

                // Typing-cadence tracking is stricter: Backspace/Delete
                // count as "edits", everything else as a normal
                // keystroke. Skip when it's not really text entry:
                //   - Modifier-only keys (shift/ctrl/alt/meta) don't
                //     produce characters.
                //   - Shortcut combos with Cmd/Ctrl (e.g. ⌘V paste,
                //     ⌘A select-all) — the paste gesture is counted
                //     separately via onPaste; logging the "v" keystroke
                //     too would double-count a single user action.
                //   - IME composition (Chinese/Japanese/Korean input)
                //     fires many intermediate keydowns per character;
                //     counting them inflates cadence for i18n users.
                const isEdit = e.key === "Backspace" || e.key === "Delete";
                const isModifier =
                  e.key === "Shift" ||
                  e.key === "Control" ||
                  e.key === "Alt" ||
                  e.key === "Meta";
                const isShortcut = e.metaKey || e.ctrlKey;
                const isComposing =
                  e.nativeEvent.isComposing || e.keyCode === 229;
                if (!isModifier && !isShortcut && !isComposing) {
                  telemetry.recordKeystroke(isEdit);
                }

                // Cmd/Ctrl + Enter sends so phone typers don't hit it
                // by accident. Plain Enter just adds a newline.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              onPaste={(e) => {
                // Size only — content is never captured.
                const pasted = e.clipboardData.getData("text");
                telemetry.recordPaste(pasted.length);
                markActivity();
              }}
              placeholder="Type your answer…"
              rows={2}
              disabled={sending}
              className="flex-1 resize-none rounded-[--radius-sm] border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => void handleSend()}
              disabled={!canSend}
              className="rounded-[--radius-sm] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
          {message.length > 0 && message.trim().length < MIN_MESSAGE_CHARS && (
            <p className="mt-1 text-xs text-text-muted">
              Try a sentence or two ({MIN_MESSAGE_CHARS}+ characters).
            </p>
          )}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Reference panel — what the student is referring to while chatting.
// Single source of truth shared by the desktop sticky-left column and
// the mobile collapsible panel above the transcript. The active
// problem (next pending) is highlighted so the student knows which
// problem the agent is currently asking about; the rest read as
// secondary context.
// ────────────────────────────────────────────────────────────────────

function ReferencePanel({
  problems,
  extraction,
}: {
  problems: IntegrityProblemSummary[];
  extraction: IntegrityExtraction | null;
}) {
  // Active = first pending problem. The agent works through them in
  // order, so this matches what the student is being asked about
  // right now. -1 if all are verdicted (chat is wrapping up).
  const activeIdx = problems.findIndex((p) => p.status === "pending");
  return (
    <div className="space-y-3">
      {problems.map((p, i) => {
        if (!p.question) return null;
        const isActive = i === activeIdx;
        return (
          <div
            key={p.problem_id}
            className={cn(
              "rounded-[--radius-sm] border px-3 py-2",
              isActive
                ? "border-primary/60 bg-primary-bg/40"
                : "border-border-light bg-bg-subtle",
            )}
          >
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
                Problem {p.sample_position + 1}
              </div>
              {isActive && (
                <div className="text-[10px] font-bold uppercase tracking-wide text-primary">
                  · current
                </div>
              )}
            </div>
            <div className="mt-1 text-sm text-text-primary">
              <MathText text={p.question} />
            </div>
          </div>
        );
      })}
      {extraction && (
        <div className="rounded-[--radius-sm] border border-border-light bg-bg-subtle px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
            Your work (as we read it)
          </div>
          <div className="mt-1">
            <ExtractionView extraction={extraction} variant="compact" />
          </div>
        </div>
      )}
    </div>
  );
}

function TurnBubble({ turn }: { turn: IntegrityTurn }) {
  const isStudent = turn.role === "student";
  // Variant-probe turns are rendered as a distinguished "Quick
  // practice" card so the student visually registers a fresh problem,
  // not normal chat flow. Only applies to agent turns; the server
  // never sets the flag on student turns.
  if (!isStudent && turn.is_variant_probe) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[90%] rounded-[--radius-md] border-2 border-primary/40 bg-primary-bg/30 px-3 py-2">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-primary">
            Quick practice
          </div>
          <div className="text-sm text-text-primary">
            {/* Variant problems may contain LaTeX / SVG / chem
                diagrams like every other problem surface in the app.
                MathText renders inline + display math, svg blocks,
                and bolded text; falls back to plain text on parse
                failure so malformed output never breaks the card. */}
            <MathText text={turn.content} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("flex", isStudent ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-[--radius-md] px-3 py-2 text-sm",
          isStudent
            ? "whitespace-pre-wrap bg-primary text-white"
            : "border border-border bg-surface text-text-primary",
        )}
      >
        {isStudent ? (
          turn.content
        ) : (
          // Agent messages routinely contain LaTeX (matrix notation,
          // fractions), **bold** markdown, and occasionally SVG /
          // chem diagrams. MathText renders inline + display math,
          // bolded spans, and svg blocks; falls back to plain text
          // on parse failure so malformed output never breaks a bubble.
          // Student messages stay as plain text — typing cadence
          // matters for the telemetry signal and a Markdown-rendered
          // student input would be weird.
          <MathText text={turn.content} />
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Practice nudge — end-of-chat CTA to the linked practice tab.
// Renders only when the agent's disposition suggests extra study
// would help AND a practice set is actually linked to this HW.
// Any other combination stays silent: we don't want to nudge
// students who passed, flag_for_review cases (which are teacher-
// action anyway), or cases where no practice set exists yet.
// ────────────────────────────────────────────────────────────────────

function PracticeNudge({
  disposition,
  courseId,
  linkedPracticeId,
}: {
  disposition: string | null;
  courseId: string;
  linkedPracticeId: string | null;
}) {
  if (!linkedPracticeId) return null;
  if (disposition !== "needs_practice" && disposition !== "tutor_pivot") {
    return null;
  }
  const copy =
    disposition === "needs_practice"
      ? {
          lead: "Want to try a few more like this?",
          button: "Go to Practice",
        }
      : {
          lead: "Not quite clear? Walk through it step by step.",
          button: "Go to Learn",
        };
  return (
    <div className="mt-3 rounded-[--radius-md] border border-primary/30 bg-primary/5 px-4 py-3 text-center">
      <p className="text-sm text-text-primary">{copy.lead}</p>
      <Link
        href={`/school/student/courses/${courseId}/practice/${linkedPracticeId}`}
        className="mt-2 inline-flex rounded-[--radius-sm] bg-primary px-4 py-1.5 text-sm font-bold text-white hover:bg-primary/90"
      >
        {copy.button} →
      </Link>
    </div>
  );
}
