import { TurnTelemetryTracker } from "./turnTelemetry";

describe("TurnTelemetryTracker", () => {
  it("returns null cadence and empty events before any input", () => {
    const t = new TurnTelemetryTracker();
    expect(t.build()).toEqual({
      focus_blur_events: [],
      paste_events: [],
      typing_cadence: null,
      need_more_time_used: false,
      device_type: "mobile",
    });
  });

  it("summarizes typing cadence: span, long pauses, and edits", () => {
    const t = new TurnTelemetryTracker();
    const at = "2026-06-23T00:00:00Z";
    t.recordTextChange("a", 0, at); // first keystroke
    t.recordTextChange("ab", 500, at); // quick
    t.recordTextChange("abcd", 5000, at); // >3s pause
    t.recordTextChange("abc", 5200, at); // deletion → edit
    const out = t.build();
    expect(out.typing_cadence).toEqual({ total_ms: 5200, pauses_over_3s: 1, edits: 1 });
  });

  it("flags a large single insertion as a paste, small growth as typing", () => {
    const t = new TurnTelemetryTracker();
    const at = "2026-06-23T00:00:00Z";
    t.recordTextChange("hi", 0, at); // 2 chars, not a paste
    t.recordTextChange("hi" + "x".repeat(40), 100, at); // +40 → paste
    const out = t.build();
    expect(out.paste_events).toEqual([{ at, byte_count: 40 }]);
  });

  it("records backgrounded intervals as blur events, ignoring zero-length", () => {
    const t = new TurnTelemetryTracker();
    t.recordBlur(4200, "2026-06-23T00:00:01Z");
    t.recordBlur(0, "2026-06-23T00:00:09Z"); // ignored
    expect(t.build().focus_blur_events).toEqual([{ at: "2026-06-23T00:00:01Z", duration_ms: 4200 }]);
  });

  it("reset clears per-turn state", () => {
    const t = new TurnTelemetryTracker();
    t.recordTextChange("hello", 0, "x");
    t.recordBlur(1000, "x");
    t.reset();
    expect(t.build()).toEqual({
      focus_blur_events: [],
      paste_events: [],
      typing_cadence: null,
      need_more_time_used: false,
      device_type: "mobile",
    });
  });
});
