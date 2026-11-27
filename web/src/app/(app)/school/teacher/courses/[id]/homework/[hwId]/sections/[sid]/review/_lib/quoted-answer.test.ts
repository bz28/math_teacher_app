// What the integrity card quotes, and which answers it shows as
// paste/tab-out evidence. Run:
//   node --experimental-strip-types <this file>   (pnpm test runs it too)
import assert from "node:assert/strict";
import { test } from "node:test";
import { flaggedTurns, quotedAnswer } from "./quoted-answer.ts";

type Turn = Parameters<typeof quotedAnswer>[0]["transcript"][number];
type Summary = Parameters<typeof quotedAnswer>[0]["activity_summary"];
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

function summary(notable: { ordinal: number; reasons: string[] }[]): Summary {
  return {
    totals: { tab_out_count: 0, tab_out_total_ms: 0, paste_count: 1, paste_total_chars: 412, paste_largest_chars: 412 },
    notable_turns: notable,
  } as Summary;
}

test("quotes the last non-empty answer and the AI question before it", () => {
  const q = quotedAnswer({ transcript, activity_summary: null });
  assert.equal(q?.turn.content, "idk the same thing");
  assert.equal(q?.question, "What if the sign flipped?");
});

test("a paste-marked earlier answer does NOT replace the last answer as the quote", () => {
  const q = quotedAnswer({ transcript, activity_summary: summary([{ ordinal: 1, reasons: ["large_paste"] }]) });
  assert.equal(q?.turn.content, "idk the same thing");
});

test("no student answer (only the AI opener): nothing to quote", () => {
  assert.equal(quotedAnswer({ transcript: [turn(0, "agent", "Hi")], activity_summary: null }), null);
});

test("flaggedTurns: the marked answers with their reasons, in order", () => {
  const f = flaggedTurns({ transcript, activity_summary: summary([{ ordinal: 1, reasons: ["large_paste", "long_tab_out"] }]) });
  assert.deepEqual(f.map((x) => [x.turn.content, x.reasons]), [["to cancel y", ["large_paste", "long_tab_out"]]]);
});

test("flaggedTurns: none without an activity summary or notable turns", () => {
  assert.deepEqual(flaggedTurns({ transcript, activity_summary: null }), []);
  assert.deepEqual(flaggedTurns({ transcript, activity_summary: summary([]) }), []);
});

test("flaggedTurns: a marked ordinal without telemetry is skipped", () => {
  assert.deepEqual(flaggedTurns({ transcript, activity_summary: summary([{ ordinal: 4, reasons: ["long_tab_out"] }]) }), []);
});
