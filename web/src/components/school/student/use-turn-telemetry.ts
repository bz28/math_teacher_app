"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Client-captured behavioral signals for a single integrity-check
 * student turn. Mirrors `api/routes/integrity_check.py::TurnTelemetry`.
 *
 * Teacher-facing evidence only. The chat never surfaces any of this
 * to the student.
 */
export interface TurnTelemetry {
  focus_blur_events: Array<{ at: string; duration_ms: number }>;
  paste_events: Array<{ at: string; byte_count: number }>;
  typing_cadence: {
    total_ms: number;
    pauses_over_3s: number;
    edits: number;
  } | null;
  need_more_time_used: boolean;
  device_type: "desktop" | "mobile" | null;
}

/**
 * Heuristic: pauses above this threshold (between keystrokes) count
 * as "stopped typing, then came back". Distinguishes steady typing
 * with thought-pauses from silent-then-bulk-insert.
 */
const CADENCE_PAUSE_MS = 3000;

/**
 * Caps the hook enforces at the source so an honest client never
 * submits values the server will reject. 24h and 1 MB match the
 * server-side TurnTelemetry validation.
 */
const MAX_BLUR_DURATION_MS = 86_400_000;
const MAX_PASTE_BYTE_COUNT = 1_000_000;
const MAX_EVENTS_PER_TURN = 256;

type TurnTelemetryApi = {
  /** Record a paste event on the chat input. Size is capped at the
   *  server's per-event limit; arrays are capped at the server's
   *  per-turn limit so an honest client never trips validation. */
  recordPaste: (byteCount: number) => void;
  /** Record a keystroke. `isEdit` = true for backspace/delete so
   *  cadence distinguishes corrections from new typing. */
  recordKeystroke: (isEdit?: boolean) => void;
  /** Return a snapshot of the accumulated telemetry for the turn
   *  without touching internal state. Caller decides when to reset. */
  snapshot: () => TurnTelemetry;
  /** Clear accumulated state. Call after a successful /turn POST so
   *  a failed send doesn't lose the original signals on retry. */
  reset: () => void;
};

/**
 * useTurnTelemetry hook.
 *
 * Attaches a window-level `visibilitychange` listener to capture
 * focus/blur intervals, plus methods the caller wires into the
 * textarea's `onPaste` and `onKeyDown` handlers to capture paste
 * events and typing cadence.
 *
 * All captured state lives in refs (not React state) — we don't want
 * to re-render the chat on every keystroke just because a counter
 * ticked up. The caller pulls a snapshot on /turn submit.
 *
 * No teardown concerns beyond the visibility listener; snapshotAndReset
 * clears refs in place.
 */
export function useTurnTelemetry(): TurnTelemetryApi {
  const focusBlurEvents = useRef<Array<{ at: string; duration_ms: number }>>(
    [],
  );
  const pasteEvents = useRef<Array<{ at: string; byte_count: number }>>([]);
  const blurStart = useRef<number | null>(null);

  const firstKeystroke = useRef<number | null>(null);
  const lastKeystroke = useRef<number | null>(null);
  const pausesOver3s = useRef<number>(0);
  const edits = useRef<number>(0);

  // Detect mobile from UA at mount — good enough for our "device
  // hint" signal (teacher evidence, not gating anything).
  const deviceType = useRef<"desktop" | "mobile" | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = window.navigator.userAgent || "";
    deviceType.current = /Mobi|Android|iPhone|iPad/i.test(ua)
      ? "mobile"
      : "desktop";
  }, []);

  // Window-level focus/blur capture. visibilitychange fires on tab
  // switch + minimize + alt-tab (depending on OS). window.blur/focus
  // catches the cases visibilitychange misses on some browsers.
  useEffect(() => {
    if (typeof document === "undefined") return;

    function onHidden() {
      if (blurStart.current == null) {
        blurStart.current = Date.now();
      }
    }
    function onVisible() {
      if (blurStart.current != null) {
        const duration = Math.min(
          Date.now() - blurStart.current,
          MAX_BLUR_DURATION_MS,
        );
        focusBlurEvents.current.push({
          at: new Date(blurStart.current).toISOString(),
          duration_ms: duration,
        });
        blurStart.current = null;
      }
    }

    function onVisibilityChange() {
      if (document.hidden) onHidden();
      else onVisible();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onHidden);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onHidden);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  const recordPaste = useCallback((byteCount: number) => {
    if (pasteEvents.current.length >= MAX_EVENTS_PER_TURN) return;
    pasteEvents.current.push({
      at: new Date().toISOString(),
      byte_count: Math.min(Math.max(byteCount, 0), MAX_PASTE_BYTE_COUNT),
    });
  }, []);

  const recordKeystroke = useCallback((isEdit: boolean = false) => {
    const now = Date.now();
    if (firstKeystroke.current == null) {
      firstKeystroke.current = now;
    }
    if (
      lastKeystroke.current != null &&
      now - lastKeystroke.current >= CADENCE_PAUSE_MS
    ) {
      pausesOver3s.current += 1;
    }
    lastKeystroke.current = now;
    if (isEdit) edits.current += 1;
  }, []);

  const snapshot = useCallback((): TurnTelemetry => {
    // Close out any in-flight blur — otherwise a student who's still
    // away when they send would drop that blur interval. Shouldn't
    // happen (they can't send while the tab is hidden) but defensive.
    // Doesn't mutate blurStart; reset() clears it on success.
    const inflightBlurEvent =
      blurStart.current != null
        ? [
            {
              at: new Date(blurStart.current).toISOString(),
              duration_ms: Math.min(
                Date.now() - blurStart.current,
                MAX_BLUR_DURATION_MS,
              ),
            },
          ]
        : [];

    const cadence =
      firstKeystroke.current != null && lastKeystroke.current != null
        ? {
            total_ms: lastKeystroke.current - firstKeystroke.current,
            pauses_over_3s: pausesOver3s.current,
            edits: edits.current,
          }
        : null;

    // Cap the focus-blur array at the server's per-turn limit so an
    // honest client with unusual signal never trips validation.
    const focusBlurWithInflight = [
      ...focusBlurEvents.current,
      ...inflightBlurEvent,
    ].slice(0, MAX_EVENTS_PER_TURN);

    return {
      focus_blur_events: focusBlurWithInflight,
      paste_events: [...pasteEvents.current],
      typing_cadence: cadence,
      need_more_time_used: false,
      device_type: deviceType.current,
    };
  }, []);

  const reset = useCallback(() => {
    focusBlurEvents.current = [];
    pasteEvents.current = [];
    blurStart.current = null;
    firstKeystroke.current = null;
    lastKeystroke.current = null;
    pausesOver3s.current = 0;
    edits.current = 0;
  }, []);

  return {
    recordPaste,
    recordKeystroke,
    snapshot,
    reset,
  };
}
