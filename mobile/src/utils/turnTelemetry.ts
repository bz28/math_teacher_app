import { useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import type { components } from "../services/api-schema.gen";

// Behavioral signals the teacher reviews on a flagged integrity check. The web
// captures focus-blur/paste/typing-cadence in the browser; mobile's equivalent
// of "tabbed out" is the app being backgrounded mid-chat (arguably stronger —
// you have to leave the app to look something up). Paste is best-effort: a big
// single jump in the text is treated as a paste. The backend stores this as-is
// and caps array sizes, so over-reporting can't pollute the record.

export type TurnTelemetry = components["schemas"]["TurnTelemetry"];

const PASTE_MIN_BYTES = 30; // a single onChangeText growth this large ≈ a paste
const PAUSE_MS = 3000;
const MAX_EVENTS = 50; // keep arrays bounded client-side too

/** Pure accumulator — timestamps are injected so it unit-tests without clocks. */
export class TurnTelemetryTracker {
  private blurs: { at: string; duration_ms: number }[] = [];
  private pastes: { at: string; byte_count: number }[] = [];
  private firstKeyAt: number | null = null;
  private lastKeyAt: number | null = null;
  private pauses = 0;
  private edits = 0;
  private prevLen = 0;
  private needMoreTime = false;

  /** Student tapped the calm "I need more time" affordance this turn. A
   *  benign signal for the teacher (it means we extended their window, not
   *  that anything is wrong) — persists for the rest of the session like web. */
  markNeedMoreTime(): void {
    this.needMoreTime = true;
  }

  /** A backgrounded interval that ended (app returned to foreground). */
  recordBlur(durationMs: number, at: string): void {
    if (durationMs > 0 && this.blurs.length < MAX_EVENTS) {
      this.blurs.push({ at, duration_ms: Math.round(durationMs) });
    }
  }

  /** Every composer keystroke/change for the current turn. */
  recordTextChange(text: string, nowMs: number, at: string): void {
    const len = text.length;
    if (this.firstKeyAt == null) {
      this.firstKeyAt = nowMs;
    } else if (this.lastKeyAt != null && nowMs - this.lastKeyAt > PAUSE_MS) {
      this.pauses++;
    }
    const delta = len - this.prevLen;
    if (delta < 0) {
      this.edits++; // a deletion/correction
    } else if (delta >= PASTE_MIN_BYTES && this.pastes.length < MAX_EVENTS) {
      // byte_count is approximated as a character-count delta — close enough
      // for the teacher's "pasted a big block" signal; never the content.
      this.pastes.push({ at, byte_count: delta });
    }
    this.lastKeyAt = nowMs;
    this.prevLen = len;
  }

  build(): TurnTelemetry {
    const typing_cadence =
      this.firstKeyAt != null && this.lastKeyAt != null
        ? { total_ms: Math.max(0, this.lastKeyAt - this.firstKeyAt), pauses_over_3s: this.pauses, edits: this.edits }
        : null;
    return {
      focus_blur_events: this.blurs,
      paste_events: this.pastes,
      typing_cadence,
      need_more_time_used: this.needMoreTime,
      device_type: "mobile",
    };
  }

  /** Clear per-turn state for the next turn. */
  reset(): void {
    this.blurs = [];
    this.pastes = [];
    this.firstKeyAt = null;
    this.lastKeyAt = null;
    this.pauses = 0;
    this.edits = 0;
    this.prevLen = 0;
    this.needMoreTime = false;
  }
}

/**
 * Thin RN wrapper: owns one tracker, listens for app background/foreground to
 * record blur intervals, and exposes the per-turn hooks the chat screen needs.
 */
export function useTurnTelemetry() {
  const tracker = useRef(new TurnTelemetryTracker());
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      // Only true backgrounding (the user left the app) counts — not iOS's
      // transient "inactive" (control center, app-switcher peek, a call banner),
      // which would over-report the "stepped away to look it up" signal.
      if (next === "background") {
        if (backgroundedAt.current == null) backgroundedAt.current = Date.now();
      } else if (next === "active" && backgroundedAt.current != null) {
        const since = backgroundedAt.current;
        tracker.current.recordBlur(Date.now() - since, new Date(since).toISOString());
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, []);

  // Stable identity (methods only touch the ref) so callers can safely depend on it.
  return useMemo(
    () => ({
      onTextChange: (text: string) =>
        tracker.current.recordTextChange(text, Date.now(), new Date().toISOString()),
      markNeedMoreTime: () => tracker.current.markNeedMoreTime(),
      collect: () => tracker.current.build(),
      reset: () => tracker.current.reset(),
    }),
    [],
  );
}
