// Which student answer the integrity card quotes. Run:
//   node --experimental-strip-types <this file>   (pnpm test runs it too)
import assert from "node:assert/strict";
import { test } from "node:test";
import { quotedAnswer } from "./quoted-answer.ts";

type Turn = Parameters<typeof quotedAnswer>[0]["transcript"][number];
const telemetry = {
  focus_blur_events: [],
  paste_events: [{ at: "2026-11-26T00:00:00Z", byte_count: 412 }],
  typing_cadence: { total_ms: 1000, pauses_over_3s: 0 },
} as unknown as Turn["telemetry"];

function turn(ordinal: number, role: string, content: string, tel = false): Turn {
  return {
    ordinal, role, content, tool_name: null, seconds_on_turn: null,
    created_at: "2026-11-26T00:00:00Z", telemetry: tel ? telemetry : null,
  } as Turn;
}

const transcript = [
  turn(0, "agent", "Why add the equations?"),
  turn(1, "student", "to cancel y", true),
  turn(2, "tool", "{}"),
  turn(3, "agent", "What if the sign flipped?"),
  turn(4, "student", "idk the same thing"),
  turn(5, "student", "   "),
];

test("no notable turn: quotes the last non-empty answer and the AI question before it", () => {
  const q = quotedAnswer({ transcript, activity_summary: null });
  assert.equal(q?.turn.content, "idk the same thing");
  assert.equal(q?.question, "What if the sign flipped?");
  assert.equal(q?.reason, null);
});

test("a notable turn wins over the last answer, with its reason", () => {
  const q = quotedAnswer({
    transcript,
    activity_summary: {
      totals: { tab_out_count: 0, tab_out_total_ms: 0, paste_count: 1, paste_total_chars: 412, paste_largest_chars: 412 },
      notable_turns: [{ ordinal: 1, reasons: ["large_paste"] }],
    },
  });
  assert.equal(q?.turn.content, "to cancel y");
  assert.equal(q?.question, "Why add the equations?");
  assert.equal(q?.reason, "large_paste");
});

test("a notable ordinal without telemetry falls back to the last answer", () => {
  const q = quotedAnswer({
    transcript,
    activity_summary: {
      totals: { tab_out_count: 1, tab_out_total_ms: 9000, paste_count: 0, paste_total_chars: 0, paste_largest_chars: 0 },
      notable_turns: [{ ordinal: 4, reasons: ["long_tab_out"] }],
    },
  });
  assert.equal(q?.turn.content, "idk the same thing");
  assert.equal(q?.reason, null);
});

test("no student answer (only the AI opener): nothing to quote", () => {
  assert.equal(quotedAnswer({ transcript: [turn(0, "agent", "Hi")], activity_summary: null }), null);
});
