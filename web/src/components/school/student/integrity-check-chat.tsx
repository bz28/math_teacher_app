"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  schoolStudent,
  type IntegrityStateResponse,
  type IntegrityTurn,
} from "@/lib/api";
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
export function IntegrityCheckChat({ submissionId, onDone }: Props) {
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

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-2xl flex-col">
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

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-2 py-4"
      >
        {visibleTranscript.map((t) => (
          <TurnBubble key={`${t.ordinal}-${t.role}`} turn={t} />
        ))}
        {sending && pendingStudentMessage === null && (
          <div className="text-xs text-text-muted">Thinking…</div>
        )}
      </div>

      {isComplete ? (
        <div className="border-t border-border-light px-2 py-4 text-center">
          <div className="text-sm text-text-secondary">
            Thanks — your work is with your teacher.
          </div>
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
  );
}

function TurnBubble({ turn }: { turn: IntegrityTurn }) {
  const isStudent = turn.role === "student";
  return (
    <div className={cn("flex", isStudent ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-[--radius-md] px-3 py-2 text-sm",
          isStudent
            ? "bg-primary text-white"
            : "border border-border bg-surface text-text-primary",
        )}
      >
        {turn.content}
      </div>
    </div>
  );
}
