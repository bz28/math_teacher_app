// node --test src/components/school/teacher/question-bank/bank-groups.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { LOOSE_GROUP_TITLE, defaultUnitFilter, groupBankItems } from "./bank-groups.ts";

type Use = { id: string; title: string; type: string; status: string; unit_ids: string[] };
const hw = (id: string, title: string, status = "published", type = "homework"): Use => ({
  id, title, type, status, unit_ids: [],
});
const item = (id: string, over: Partial<{
  title: string; question: string; status: string; unit_id: string;
  parent_question_id: string | null; used_in: Use[];
}> = {}) => ({
  id, title: `T ${id}`, question: `Q ${id}`, status: "approved", unit_id: "u1",
  parent_question_id: null, used_in: [] as Use[], ...over,
});

test("groups by homework, loose questions last, titles sorted", () => {
  const g = groupBankItems([
    item("a", { used_in: [hw("h2", "Systems Word Problems")] }),
    item("b"),
    item("c", { used_in: [hw("h1", "Graphing Linear Systems")] }),
    item("d", { used_in: [hw("h1", "Graphing Linear Systems")] }),
  ], {});
  assert.deepEqual(g.map((x) => [x.title, x.items.map((i) => i.id)]), [
    ["Graphing Linear Systems", ["c", "d"]],
    ["Systems Word Problems", ["a"]],
    [LOOSE_GROUP_TITLE, ["b"]],
  ]);
  assert.equal(g[0].detail, "Published");
});

test("only approved primaries, minus what the homework already has", () => {
  const g = groupBankItems([
    item("ok"),
    item("pending", { status: "pending" }),
    item("variation", { parent_question_id: "ok" }),
    item("already"),
  ], { excludeIds: ["already"] });
  assert.deepEqual(g.flatMap((x) => x.items.map((i) => i.id)), ["ok"]);
});

test("search needs every word, in the title or the question", () => {
  const g = groupBankItems([
    item("a", { title: "Ticket sales", question: "Adult tickets cost $8" }),
    item("b", { title: "Two lines", question: "Solve y = 2x + 1" }),
  ], { query: "  TICKETS  adult " });
  assert.deepEqual(g.flatMap((x) => x.items.map((i) => i.id)), ["a"]);
});

test("unit filter; a homework is preferred over a practice set as the group", () => {
  const g = groupBankItems([
    item("a", { unit_id: "u2" }),
    item("sub", { unit_id: "u1-sub" }),
    item("b", { used_in: [hw("p", "Practice A", "draft", "practice"), hw("h", "HW A")] }),
    item("c", { used_in: [hw("p", "Practice A", "draft", "practice")] }),
  ], { unitIds: new Set(["u1", "u1-sub"]) });
  assert.deepEqual(g.map((x) => [x.title, x.detail]), [
    ["HW A", "Published"],
    ["Practice A", "Practice · Draft"],
    [LOOSE_GROUP_TITLE, ""],
  ]);
});

test("the unit filter starts on the homework's unit, or every unit when it spans several", () => {
  assert.equal(defaultUnitFilter(["u1"]), "u1");
  assert.equal(defaultUnitFilter(["u3", "u4"]), "");
  assert.equal(defaultUnitFilter([]), "");
});
