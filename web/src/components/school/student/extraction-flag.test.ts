// Unit tests for the confirm screen's flag-step helpers.
// Runs on plain Node (>=22.6) via native TS type-stripping.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerPreview,
  FLAG_NOTE_STARTERS,
  flagNoteReady,
  hasEditableLines,
  withStarter,
} from "./extraction-flag.ts";

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

test("the whole-reading note needs a real pointer", () => {
  assert.equal(flagNoteReady(""), false);
  assert.equal(flagNoteReady("   "), false);
  assert.equal(flagNoteReady("no"), false);
  assert.equal(flagNoteReady("P9 is 65"), true);
});

test("a starter fills, appends, and never repeats", () => {
  assert.equal(withStarter("", "Most lines are wrong"), "Most lines are wrong");
  assert.equal(withStarter("  ", "Most lines are wrong"), "Most lines are wrong");
  assert.equal(
    withStarter("Problem 3 is off", "Most lines are wrong"),
    "Problem 3 is off. Most lines are wrong",
  );
  assert.equal(
    withStarter("Problem 3 is off!", "Most lines are wrong"),
    "Problem 3 is off! Most lines are wrong",
  );
  assert.equal(
    withStarter("Most lines are wrong", "Most lines are wrong"),
    "Most lines are wrong",
  );
  for (const s of FLAG_NOTE_STARTERS) assert.ok(flagNoteReady(s));
});

test("a tile previews the answer we read, plain text first", () => {
  assert.equal(answerPreview({ answer_plain: "63", answer_latex: "63" }), "63");
  assert.equal(answerPreview({ answer_plain: " ", answer_latex: "\\frac{1}{2}" }), "\\frac{1}{2}");
  assert.equal(answerPreview({ answer_plain: null, answer_latex: null }), null);
  assert.equal(answerPreview(undefined), null);
});
