import assert from "node:assert/strict";
import { test } from "node:test";
import { urlSchoolParam } from "./urlScope.ts";

const ID = "816bbe68-b080-4896-8142-d44930266322";
const read = (q: string) => urlSchoolParam(new URLSearchParams(q));

test("a school id in the URL scopes to it, either key", () => {
  assert.deepEqual(read(`school=${ID}`), { school: ID });
  assert.deepEqual(read(`school_id=${ID}`), { school: ID });
});

test("'all' says All schools, so a recipient's saved scope can't stand in", () => {
  assert.deepEqual(read("school=all"), { school: null });
});

test("empty, mangled or absent says nothing", () => {
  for (const q of ["", "school=", "school=abc", "tab=margin"]) assert.equal(read(q), null);
});
