/**
 * The Spend tab's pure pieces. Each case names the bug it exists to
 * prevent (review round 1 of the Costs page).
 *
 * Explicit .ts import specifiers: Node's ESM resolver does not infer
 * extensions.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SpendRow } from "../../lib/costsApi.ts";
import { barValue, drillTo, isConcentrated, perCall } from "./spendFormat.ts";

const row = (key: string | null): SpendRow => ({
  key, label: key ?? "not tied to a teacher", calls: 1, cost: 1, share: 1, cost_per_call: 1,
});

test("the Internal school row has no page to drill to", () => {
  // /schools/internal 422s: the school id is a UUID.
  assert.equal(drillTo(row("internal"), "school"), null);
  assert.equal(drillTo(row("8f1c"), "school"), "/schools/8f1c");
});

test("the remainder row never drills", () => {
  assert.equal(drillTo(row(null), "teacher"), null);
});

test("function and model rows drill to the Calls hub, filtered", () => {
  assert.equal(drillTo(row("ai_grading"), "function"), "/llm-calls?function=ai_grading&hours=720");
  assert.equal(drillTo(row("claude-opus-5-5"), "model"), "/llm-calls?model=claude-opus-5-5&hours=720");
});

test("scoped to one school, the concentration note stays quiet", () => {
  const one = { schools_with_spend: 1, top_school_id: "a", top_school_name: "Radnor", top_school_share: 1 };
  assert.equal(isConcentrated(one, false), true);
  assert.equal(isConcentrated(one, true), false);
  assert.equal(
    isConcentrated({ schools_with_spend: 5, top_school_id: "a", top_school_name: "R", top_school_share: 0.4 }, false),
    false,
  );
});

test("a cheap call's cost doesn't round to $0.000", () => {
  assert.equal(perCall(0.0003), "$0.00030");
  assert.equal(perCall(0.029), "$0.029");
  assert.equal(perCall(2.5), "$2.50");
  assert.equal(perCall(null), "—");
});

test("a bar under a cent isn't labelled 0.00", () => {
  assert.equal(barValue(0.004), "<0.01");
  assert.equal(barValue(0), "");
  assert.equal(barValue(5.239), "5.24");
});
