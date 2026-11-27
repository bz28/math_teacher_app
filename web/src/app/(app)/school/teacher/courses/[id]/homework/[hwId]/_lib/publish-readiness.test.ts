// Publish rules shared by the homework page and the question review's
// "All caught up" screen.
//   node --experimental-strip-types --test 'src/app/(app)/school/teacher/courses/[id]/homework/[hwId]/_lib/publish-readiness.test.ts'
import assert from "node:assert/strict";
import { test } from "node:test";
import { missingForPublishOf, publishChecks, publishWarning } from "./publish-readiness.ts";

const hw = (o: Record<string, unknown> = {}) => ({
  type: "homework",
  due_at: "2026-12-01T00:00:00Z",
  unit_ids: ["u1"],
  graph_checklists: {},
  ...o,
});
const p = (id: string) => ({ bank_item_id: id });

test("hard requirements: a problem and a unit", () => {
  assert.deepEqual(missingForPublishOf(hw(), [p("a")]), []);
  assert.deepEqual(missingForPublishOf(hw({ unit_ids: [] }), []), ["at least one problem", "a unit"]);
  assert.deepEqual(missingForPublishOf(null, []), []);
});

test("warnings: no due date, unchecked and still-missing graph checklists", () => {
  const checks = publishChecks(
    hw({
      due_at: null,
      graph_checklists: {
        a: { checklist: { asks_for_drawing: true, checked: false }, can_write: true },
        b: { checklist: null, can_write: true },
        c: { checklist: { asks_for_drawing: true, checked: true }, can_write: true },
      },
    }),
    [p("a"), p("b"), p("c")],
  );
  assert.equal(checks.noDueDate, true);
  assert.deepEqual(checks.uncheckedChecklists.map((x) => x.bank_item_id), ["a"]);
  assert.deepEqual(checks.missingChecklists.map((x) => x.bank_item_id), ["b"]);
  assert.equal(checks.anyPublishWarning, true);
  assert.equal(publishChecks(hw(), [p("a")]).anyPublishWarning, false);
  // Practice never warns about a due date.
  assert.equal(publishChecks(hw({ type: "practice", due_at: null }), []).noDueDate, false);
});

test("warning wording", () => {
  const w = { noDueDate: true, uncheckedChecklists: 0, missingChecklists: 0, checklistsLookedAgain: false };
  assert.equal(publishWarning(w), "Publish without a due date? Students will see “no due date”.");
  assert.equal(
    publishWarning({ ...w, uncheckedChecklists: 2 }),
    "2 graph checklists haven’t been checked, and there’s no due date. Publish anyway?",
  );
});
