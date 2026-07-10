// Unit tests for the urgency-pill label/tone arithmetic.
// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node src/components/school/student/urgency-pill.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { urgencyLabelAndTone } from "./urgency.ts";

const NOW = new Date("2026-06-22T12:00:00.000Z");
const MIN = 60_000;
const HR = 3_600_000;
const DAY = 86_400_000;
// ISO string for `offsetMs` away from NOW (positive = future, negative = past).
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

test("null due date is muted", () => {
  assert.deepEqual(urgencyLabelAndTone(null, NOW), {
    label: "No due date",
    tone: "muted",
  });
});

test("45 minutes left shows minutes, not '1 hr' (the reported bug)", () => {
  assert.deepEqual(urgencyLabelAndTone(at(45 * MIN), NOW), {
    label: "due in 45 min",
    tone: "red",
  });
});

test("12 minutes left shows minutes", () => {
  assert.equal(urgencyLabelAndTone(at(12 * MIN), NOW).label, "due in 12 min");
});

test("90 minutes left stays in minutes (under 2h)", () => {
  assert.equal(urgencyLabelAndTone(at(90 * MIN), NOW).label, "due in 90 min");
});

test("2h boundary: 119 min -> minutes, exactly 120 min -> '2 hr'", () => {
  assert.equal(urgencyLabelAndTone(at(119 * MIN), NOW).label, "due in 119 min");
  assert.equal(urgencyLabelAndTone(at(120 * MIN), NOW).label, "due in 2 hr");
});

test("hours floor, never round up: 5h59m renders '5 hr' not '6 hr'", () => {
  assert.equal(
    urgencyLabelAndTone(at(5 * HR + 59 * MIN), NOW).label,
    "due in 5 hr",
  );
});

test("under a minute left -> 'due now'", () => {
  assert.deepEqual(urgencyLabelAndTone(at(30_000), NOW), {
    label: "due now",
    tone: "red",
  });
});

test("day/tone thresholds stay intact", () => {
  assert.deepEqual(urgencyLabelAndTone(at(25 * HR), NOW), {
    label: "due tomorrow",
    tone: "amber",
  });
  assert.deepEqual(urgencyLabelAndTone(at(3 * DAY), NOW), {
    label: "due in 3 days",
    tone: "amber",
  });
  assert.deepEqual(urgencyLabelAndTone(at(5 * DAY), NOW), {
    label: "due in 5 days",
    tone: "muted",
  });
});

test("overdue by 45 min shows minutes, never 'overdue by 0 hr'", () => {
  assert.deepEqual(urgencyLabelAndTone(at(-45 * MIN), NOW), {
    label: "overdue by 45 min",
    tone: "red",
  });
});

test("just-overdue (<1 min) collapses to 'overdue'", () => {
  assert.deepEqual(urgencyLabelAndTone(at(-30_000), NOW), {
    label: "overdue",
    tone: "red",
  });
});

test("overdue hours and days", () => {
  assert.equal(urgencyLabelAndTone(at(-5 * HR), NOW).label, "overdue by 5 hr");
  assert.equal(urgencyLabelAndTone(at(-1 * DAY), NOW).label, "overdue by 1 day");
  assert.deepEqual(urgencyLabelAndTone(at(-2 * DAY), NOW), {
    label: "overdue by 2 days",
    tone: "red",
  });
});
