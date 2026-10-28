// Unit tests for the rubric merge + drift check. Plain Node (>=22.6):
//   node --experimental-strip-types --test src/lib/rubric.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClassRubricRule } from "./api.ts";
import { effectiveRubric, normalizeRubric, rubricChanged } from "./rubric.ts";

const rule = (id: string, text: string, points: number | null = 5): ClassRubricRule => ({
  id, text, points, source: "settings", source_label: null, added_at: null,
});

describe("normalizeRubric", () => {
  it("keeps skipped rule ids through a text edit", () => {
    assert.deepEqual(normalizeRubric({ notes: "  Two periods. ", skipped_rule_ids: ["r2", "r1", "r2"] }), { notes: "Two periods.", skipped_rule_ids: ["r1", "r2"] });
  });

  it("drops empty text and an empty skip list", () => {
    assert.deepEqual(normalizeRubric({ notes: "   ", skipped_rule_ids: [] }), {});
    assert.deepEqual(normalizeRubric(null), {});
  });
});

describe("effectiveRubric", () => {
  it("adds the class rules a homework hasn't skipped", () => {
    assert.deepEqual(effectiveRubric([rule("r1", "Units"), rule("r2", "y =")], {
        notes: "Two periods.", skipped_rule_ids: ["r2"],
      }), { notes: "Two periods.", rules: [{ id: "r1", text: "Units", points: 5 }] });
  });

  it("is null when there is nothing at all", () => {
    assert.equal(effectiveRubric([], null), null);
    assert.equal(effectiveRubric([rule("r1", "Units")], { skipped_rule_ids: ["r1"] }), null);
  });
});

describe("rubricChanged", () => {
  const graded = { notes: "N", rules: [{ id: "r1", text: "Units", points: 5 }] };

  it("is quiet when nothing changed", () => {
    assert.equal(rubricChanged({ ...graded }, graded), false);
  });

  it("never flags a class rule change: rules apply from now on", () => {
    assert.equal(rubricChanged({ notes: "N", rules: [...graded.rules, { id: "r2", text: "y =", points: null }] }, graded), false);
    assert.equal(rubricChanged({ notes: "N", rules: [{ id: "r1", text: "Units (ft)", points: 5 }] }, graded), false);
    assert.equal(rubricChanged({ notes: "N", rules: [{ id: "r1", text: "Units", points: 10 }] }, graded), false);
    assert.equal(rubricChanged({ notes: "N" }, graded), false);
    assert.equal(rubricChanged({ notes: "N", rules: graded.rules }, { notes: "N" }), false);
  });

  it("still flags a text change on such a grade", () => {
    assert.equal(rubricChanged({ notes: "M", rules: graded.rules }, { notes: "N" }), true);
  });
});
