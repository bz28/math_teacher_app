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
  /** Called when the chat reaches a TERMINAL state (complete /
   *  skipped_unreadable) and the kid taps "Back to homework", AND for
   *  the load-error recovery button — both want an in-place re-fetch
   *  (`setMode(homework)` + `loadAll`). For a transient load failure
   *  that re-fetch re-routes back into the now-working chat, i.e. it's
   *  the retry. Wrong for a *deliberate* mid-check exit, where the
   *  re-fetch just re-detects the in-progress check and bounces the
   *  student back in — use `onLeave` for that. */
  onDone: () => void;
  /** Called when the kid taps "Leave & come back later" mid-check.
   *  Unlike `onDone`, this must *navigate away* from the homework
   *  route — re-fetching in place would re-detect the in-progress
   *  check and bounce them back into the chat. Their progress is saved
   *  server-side, so returning to the homework re-hydrates the
   *  transcript and resumes. */
  onLeave: () => void;
}

const MIN_MESSAGE_CHARS = 5;

// The honest "I can't explain this" exit. Tapping the chip sends this
// as the student's message, bypassing the MIN_MESSAGE_CHARS gate so a
// truthful "I'm stuck" is always one tap away — never a blocked send
// that effectively coaches a frozen kid into fabricating an answer.
// The agent already handles arbitrary input and replies supportively.
const STUCK_MESSAGE = "I'm stuck — I'm not sure how to explain this.";

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
  onLeave,
}: Props) {
  const [state, setState] = useState<IntegrityStateResponse | null>(null);
  const [pendingStudentMessage, setPendingStudentMessage] =
    useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnStartedAt, setTurnStartedAt] = useState<number>(Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the student is parked at (or near) the bottom of the
  // transcript. Updated on scroll; consulted before auto-scrolling on
  // new turns so we never yank a student who scrolled up to re-read
  // their own work back down to the latest message.
  const atBottomRef = useRef<boolean>(true);
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

  // Auto-scroll to the newest turn whenever the transcript grows — but
  // only when the student was already at the bottom. If they scrolled
  // up to re-read the problem or their own earlier answer, leave them
  // there instead of yanking them to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state?.transcript.length, pendingStudentMessage]);

  // Track whether the student is near the bottom (within ~120px). Read
  // by the auto-scroll effect above. Threshold is generous so normal
  // "reading the latest reply" still counts as at-bottom.
  const handleTranscriptScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = distanceFromBottom <= 120;
  };

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

  // Latest agent message, mirrored into a polite aria-live region below
  // so a screen-reader student hears each reply as it lands. We mirror
  // the newest agent turn only (not student turns, which the SR already
  // reads on send) to avoid re-announcing the whole transcript.
  const latestAgentMessage = useMemo(() => {
    for (let i = visibleTranscript.length - 1; i >= 0; i--) {
      if (visibleTranscript[i].role !== "student") {
        return visibleTranscript[i].content;
      }
    }
    return "";
  }, [visibleTranscript]);

  // `override` is the honest "I'm stuck" chip path: it carries its own
  // message and skips the MIN_MESSAGE_CHARS gate (the gate exists only
  // to stop empty / one-word free-text sends — it must never block the
  // truthful "I can't explain this"). Free-text sends pass no override
  // and stay gated.
  async function handleSend(override?: string) {
    const trimmed = (override ?? message).trim();
    const isOverride = override != null;
    if (sending || isComplete) return;
    if (!isOverride && trimmed.length < MIN_MESSAGE_CHARS) return;
    if (trimmed.length === 0) return;
    setPendingStudentMessage(trimmed);
    if (!isOverride) setMessage("");
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
    return <ChatLoadingSkeleton />;
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

  const hasReference = state.problems.length > 0;

  return (
    // Outer wrapper holds both columns at full viewport height. On
    // mobile (default) only the chat column renders, capped at
    // max-w-2xl and centered — same UX as before. On md+ a 320px
    // reference column sits to the left, always visible, so the
    // student can read the problem and their extracted work side-by-
    // side with the chat instead of toggling a panel up and down.
    <div className="mx-auto h-[calc(100dvh-4rem)] w-full max-w-5xl">
      {/* grid-rows-1 forces the single row track to fill the grid's
       *  height. Without it the implicit row defaults to `auto` and
       *  sizes to its tallest child — when the reference column has
       *  a long problem + extraction, the row stretches past the
       *  viewport, h-full on children resolves against the stretched
       *  row, the inner overflow-y-auto scrollers get no constrained
       *  height to overflow against, and the whole page scrolls
       *  instead of each column scrolling independently. */}
      <div
        className={cn(
          "grid h-full grid-rows-1",
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
            {/* tabIndex on the inner scroller lets a keyboard user
             *  tab into the panel and scroll it with arrow keys.
             *  The outer <aside> is the labeled landmark; the inner
             *  div is just a focusable scroll container, so we don't
             *  duplicate the aria-label here. */}
            <div
              tabIndex={0}
              className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
            >
              <ReferencePanel
                problems={state.problems}
                extraction={state.extraction}
              />
            </div>
          </aside>
        )}

        <div
          className={cn(
            "mx-auto flex h-full w-full max-w-2xl flex-col",
            // When the reference column is present, let the chat
            // fill the grid track. When it's absent (mobile, or no
            // problems on the session), keep the original centered
            // max-w-2xl so the chat doesn't blow out to 5xl wide.
            hasReference && "md:mx-0 md:max-w-none",
          )}
        >
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
            <div className="flex items-center gap-3">
              {totalProblems > 0 && (
                <div className="text-xs font-medium text-text-muted">
                  {problemsVerdicted} of {totalProblems}
                </div>
              )}
              {/* Pause / leave-and-resume. Uses onLeave (a real route
                  navigation), NOT onDone: re-fetching integrity state
                  in place would re-detect the in-progress check and
                  bounce the student straight back into this chat. The
                  transcript re-hydrates from the server on return, so
                  leaving mid-chat is safe and resumable. */}
              {!isComplete && (
                <button
                  type="button"
                  onClick={onLeave}
                  title="Your progress is saved — you can finish this later."
                  className="rounded-[--radius-sm] px-2 py-1 text-xs font-medium text-text-muted hover:text-text-secondary"
                >
                  Leave &amp; come back later
                </button>
              )}
            </div>
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
            onScroll={handleTranscriptScroll}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 py-4"
          >
            {/* Supportive "why am I here" intro. Always shown above
                the first agent message while the chat is active so an
                honest, anxious student understands this is routine and
                non-punitive — not an accusation. Hidden once the check
                is complete (the terminal panel speaks for itself). */}
            {!isComplete && (
              <div className="rounded-[--radius-md] border border-border-light bg-bg-subtle/60 px-4 py-3">
                <p className="font-serif text-base text-text-primary">
                  Just talk me through your thinking
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                  Your teacher uses a quick chat to hear how you worked
                  through a problem, in your own words. There are no
                  trick questions and nothing to look up — just explain
                  your thinking. It usually takes a few minutes.
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                  Just answer here in your own words — staying on this
                  page helps us see it&rsquo;s really you.
                </p>
              </div>
            )}
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
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms] motion-reduce:animate-none" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms] motion-reduce:animate-none" />
                  </span>
                  AI is thinking…
                </div>
              </div>
            )}
          </div>

          {/* Polite live region: a screen-reader student hears each new
              agent reply as it lands. Visually hidden — the bubbles above
              are the visual surface. Kept outside the scroll container so
              its updates aren't tied to scroll position. */}
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {latestAgentMessage}
          </div>

          {isComplete ? (
            <div className="border-t border-border-light px-2 py-4 text-center">
              <p className="font-serif text-base text-text-primary">
                Thanks for walking me through that!
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                Your teacher has everything they need — you&rsquo;ll see
                your grade once they publish it.
              </p>
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
                  className="mb-2 flex items-center justify-between gap-2 rounded-[--radius-sm] border border-info-border bg-info-light px-3 py-2 text-xs text-info"
                >
                  <span>Still there? Take your time.</span>
                  <button
                    type="button"
                    onClick={handleNeedMoreTime}
                    className="rounded-full bg-info px-2 py-0.5 font-bold text-white hover:bg-info/90"
                  >
                    I need more time
                  </button>
                </div>
              )}
              {error && <p className="mb-2 text-xs text-error">{error}</p>}
              {/* The honest exit. A frozen student who genuinely can't
                  put their reasoning into words taps this instead of
                  being told their truthful "idk" is too short. Sends a
                  fixed message that bypasses the char gate so the agent
                  can respond with support, not a rejection. Low emphasis
                  on purpose — always available, never the loud default. */}
              <button
                type="button"
                onClick={() => void handleSend(STUCK_MESSAGE)}
                disabled={sending}
                className="mb-2 inline-flex items-center rounded-full border border-border-light bg-bg-subtle px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
              >
                I&rsquo;m stuck — not sure how to explain this
              </button>
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
              <div className="mt-1 flex items-start justify-between gap-2">
                <p className="text-xs text-text-muted">
                  {message.length > 0 &&
                    message.trim().length < MIN_MESSAGE_CHARS &&
                    `Try a sentence or two (${MIN_MESSAGE_CHARS}+ characters).`}
                </p>
                {/* Plain Enter inserts a newline; only ⌘/Ctrl+Enter
                    sends (phone-typer safety). Surface that so desktop
                    students aren't left guessing. Desktop only — the
                    shortcut is meaningless on a touch keyboard. */}
                {device === "desktop" && (
                  <p className="shrink-0 text-xs text-text-muted">
                    <kbd className="font-sans">⌘↵</kbd> to send
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Loading skeleton — shown while the transcript hydrates on mount.
// A couple of shimmer bubbles (agent left, student right) stand in for
// the chat so the student sees the shape of what's coming instead of a
// bare "Loading…" line. Motion-reduce users get a static placeholder.
// ────────────────────────────────────────────────────────────────────

function ChatLoadingSkeleton() {
  return (
    <div
      className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-2xl flex-col"
      role="status"
      aria-label="Loading your understanding check"
    >
      <div className="border-b border-border-light px-2 py-3">
        <div className="h-3 w-40 animate-pulse rounded-full bg-border-light motion-reduce:animate-none" />
      </div>
      <div className="min-h-0 flex-1 space-y-3 px-2 py-4">
        <SkeletonBubble side="left" widthClass="w-3/4" />
        <SkeletonBubble side="right" widthClass="w-1/2" />
        <SkeletonBubble side="left" widthClass="w-2/3" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function SkeletonBubble({
  side,
  widthClass,
}: {
  side: "left" | "right";
  widthClass: string;
}) {
  return (
    <div className={cn("flex", side === "right" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "h-12 animate-pulse rounded-[--radius-md] motion-reduce:animate-none",
          widthClass,
          side === "right" ? "bg-primary/15" : "bg-border-light",
        )}
      />
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
              {/* hw_position is the actual 1-based position on the
               *  homework — server computes it from assignment.problem_ids
               *  so a student who got sampled on HW problem 3 sees
               *  "Problem 3", not "Problem 1" (which is what we'd
               *  show with sample_position+1 since MAX_SAMPLE=1
               *  pins sample_position to 0). */}
              <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
                Problem {p.hw_position}
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
            {/* Student-facing surface: show only the literal LaTeX
             *  transcription, not the AI's narrative interpretation.
             *  The student already confirmed we read the page right
             *  on the prior screen; this panel's job is a reference
             *  of what they actually wrote, not what we think they
             *  did. Same principle as the confirm screen. */}
            <ExtractionView
              extraction={extraction}
              variant="compact"
              showProse={false}
            />
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
// Renders whenever a practice set is actually linked to this HW, so
// every student gets a gentle next step — including turn-cap cases
// where the disposition is null and the student would otherwise be
// stranded with nowhere to go. We never fabricate a link: when no
// practice set exists the nudge stays silent. The disposition only
// tunes the copy (a softer "step by step" lead for tutor_pivot), it
// no longer gates whether the nudge appears at all. The verdict
// itself is never surfaced — this is purely an optional next step.
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
  const copy =
    disposition === "tutor_pivot"
      ? {
          lead: "Want to walk through this topic step by step?",
          button: "Go to Learn",
        }
      : {
          lead: "Want to practice this topic?",
          button: "Go to Practice",
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
