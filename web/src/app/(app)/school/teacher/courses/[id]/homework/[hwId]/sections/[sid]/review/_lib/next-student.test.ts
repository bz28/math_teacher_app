// Unit tests for where the review page moves next.
//   node --experimental-strip-types <this file>   (or pnpm test; --test with
//   this path treats [id] as a glob and runs nothing)
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RosterEntry } from "./types.ts";
import { approvesOnKey, awaitsApproval, needsTeacher, nextMatching } from "./next-student.ts";

type Sub = NonNullable<RosterEntry["submission"]>;
const entry = (id: string, sub: Partial<Sub> | null): RosterEntry =>
  ({
    student_id: id,
    student_name: id,
    student_email: `${id}@x`,
    personal_due_at: null,
    submission: sub
      ? ({ grade_published_at: null, grade_dirty: false, reviewed_at: null, is_preview: false, ...sub } as Sub)
      : null,
  }) as RosterEntry;

const ids = (e: RosterEntry | null) => e?.student_id ?? null;

test("an approved grade waiting only to be published doesn't await approval", () => {
  const e = entry("a", { reviewed_at: "2026-11-26T00:00:00Z" });
  assert.equal(needsTeacher(e), true);
  assert.equal(awaitsApproval(e), false);
});

test("published-and-clean, not turned in, and her own preview never await approval", () => {
  assert.equal(awaitsApproval(entry("a", { grade_published_at: "2026-11-26T00:00:00Z" })), false);
  assert.equal(awaitsApproval(entry("b", null)), false);
  assert.equal(awaitsApproval(entry("c", { is_preview: true })), false);
});

test("edited since publish and not re-approved awaits approval", () => {
  assert.equal(
    awaitsApproval(entry("a", { grade_published_at: "2026-11-26T00:00:00Z", grade_dirty: true })),
    true,
  );
});

test("nextMatching skips non-matches and wraps to the start", () => {
  const roster = [
    entry("a", {}),
    entry("b", { reviewed_at: "x" }),
    entry("c", null),
    entry("d", {}),
  ];
  assert.equal(ids(nextMatching(roster, "a", awaitsApproval)), "d");
  assert.equal(ids(nextMatching(roster, "d", awaitsApproval)), "a");
});

test("nextMatching never returns the current student, and is null when nobody else matches", () => {
  const roster = [entry("a", {}), entry("b", { reviewed_at: "x" })];
  assert.equal(nextMatching(roster, "a", awaitsApproval), null);
  assert.equal(nextMatching([entry("a", {})], "a", awaitsApproval), null);
  assert.equal(nextMatching(roster, "missing", awaitsApproval), null);
});

test("nextStudent's rule (needsTeacher) still stops on an approved-but-unpublished grade", () => {
  const roster = [entry("a", {}), entry("b", { reviewed_at: "x" })];
  assert.equal(ids(nextMatching(roster, "a", needsTeacher)), "b");
});

test("a held A never approves: only a fresh press, and only when Approve is enabled", () => {
  assert.equal(approvesOnKey({ repeat: false }, true), true);
  assert.equal(approvesOnKey({ repeat: true }, true), false);
  assert.equal(approvesOnKey({ repeat: false }, false), false);
});
