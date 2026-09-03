// Unit tests for the Customize closed-header summary.
// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node --test src/components/school/teacher/_pieces/generation-params-options.test.ts
//
// Note: only TYPE imports may cross the "@/" alias here — plain node
// cannot resolve it, and type imports are erased before it tries. That
// is why `activeSummary` takes its defaults as an argument and why the
// defaults are restated below rather than imported.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GenerationParams } from "@/lib/api";
import { PARAM_OPTIONS, activeSummary } from "./generation-params-options.ts";

const DEFAULTS: GenerationParams = {
  problem_type: "mixed",
  answer_form: "auto",
  difficulty: "mixed",
  calculator: "either",
  format: "frq",
};

const withParams = (o: Partial<GenerationParams>): GenerationParams => ({
  ...DEFAULTS,
  ...o,
});

const summary = (o: Partial<GenerationParams>) =>
  activeSummary(withParams(o), DEFAULTS);

test("the restated defaults match the real ones", () => {
  // Guards the one hazard of not importing DEFAULT_GENERATION_PARAMS:
  // every key's default must be the first option of its dropdown, which
  // is the invariant the backend relies on to emit no instruction.
  for (const { key, options } of PARAM_OPTIONS) {
    assert.equal(
      DEFAULTS[key],
      options[0].value,
      `${key}: default should be the first option`,
    );
  }
});

test("nothing customized summarizes to an empty string", () => {
  // The component swaps in the explainer copy when this is empty, so it
  // has to be falsy rather than something like "none".
  assert.equal(summary({}), "");
});

test("one setting reads as its dropdown label", () => {
  assert.equal(summary({ difficulty: "hard" }), "All hard");
});

test("two settings join in PARAM_OPTIONS order, not selection order", () => {
  // format sits after difficulty in the dropdown list, so it reads
  // second regardless of which the teacher picked first.
  assert.equal(
    summary({ format: "mcq", difficulty: "hard" }),
    "All hard · Multiple choice",
  );
});

test("more than two collapse into +N more so the header stays one line", () => {
  assert.equal(
    summary({
      problem_type: "word",
      answer_form: "integer",
      difficulty: "hard",
      format: "mcq",
    }),
    "Word problems only · Whole numbers +2 more",
  );
});

test("summary words come from PARAM_OPTIONS, so they cannot drift", () => {
  // The guard that matters: rename a dropdown label and the closed
  // header renames with it, rather than keeping a stale copy.
  const label = PARAM_OPTIONS.find((p) => p.key === "answer_form")?.options.find(
    (o) => o.value === "integer",
  )?.label;
  assert.equal(summary({ answer_form: "integer" }), label);
});

test("whole numbers is offered as an answer form", () => {
  const values = PARAM_OPTIONS.find((p) => p.key === "answer_form")?.options.map(
    (o) => o.value,
  );
  assert.ok(values?.includes("integer"));
});
