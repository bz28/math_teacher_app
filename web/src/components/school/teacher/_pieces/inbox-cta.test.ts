import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeNextFlagReason, inboxCta } from "./inbox-cta.ts";

test("flags are counted whole on the button, every kind together", () => {
  // 1 worth a look + 3 photo problems: the button says 4, not just the first kind.
  const label = inboxCta({ submitted: 5, published: 0, dirty: 0, flagged: 4 });
  assert.equal(label, "Review 4 →");
  assert.ok(label.length <= 18);
});

test("then ungraded work, then a republish, then plain review", () => {
  assert.equal(inboxCta({ submitted: 3, published: 1, dirty: 0, flagged: 0 }), "Grade 2 →");
  assert.equal(inboxCta({ submitted: 2, published: 2, dirty: 1, flagged: 0 }), "Grade 1 →");
  assert.equal(inboxCta({ submitted: 2, published: 2, dirty: 0, flagged: 0 }), "Review →");
});

test("Grade next's flag reason stays short whatever the kinds", () => {
  assert.equal(gradeNextFlagReason(4), "4 to look at");
  assert.ok(gradeNextFlagReason(40).length <= 14);
});
