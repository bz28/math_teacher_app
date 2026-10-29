// Unit tests for the confirm screen's flag-step helpers.
// Runs on plain Node (>=22.6) via native TS type-stripping.
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasEditableLines } from "./extraction-flag.ts";

test("a positioned step is editable", () => {
  assert.equal(
    hasEditableLines({
      steps: [{ problem_position: 1 }],
      final_answers: [],
    }),
    true,
  );
});

test("only unattributed 'Other work' is not editable", () => {
  assert.equal(
    hasEditableLines({
      steps: [{ problem_position: null }],
      final_answers: [{ problem_position: null, answer_latex: "5", answer_plain: "5" }],
    }),
    false,
  );
});

test("a positioned final answer with text is editable", () => {
  assert.equal(
    hasEditableLines({
      steps: [],
      final_answers: [{ problem_position: 2, answer_latex: "", answer_plain: "x = 3" }],
    }),
    true,
  );
});

test("an empty final answer isn't rendered, so it isn't editable", () => {
  assert.equal(
    hasEditableLines({
      steps: [],
      final_answers: [{ problem_position: 2, answer_latex: " ", answer_plain: null }],
    }),
    false,
  );
});

test("nothing read at all", () => {
  assert.equal(hasEditableLines({ steps: [], final_answers: [] }), false);
});
