import assert from "node:assert/strict";
import { test } from "node:test";

import { isFlaggedSubmission, type FlaggedInput } from "./roster-flagged.ts";

// One case per branch of the server's `flagged_case`
// (api/routes/teacher_courses.py; pinned server-side in
// tests/test_unfinished_check.py), so the two can't drift silently.

const overview = (
  over: Partial<NonNullable<FlaggedInput["integrity_overview"]>> = {},
): FlaggedInput["integrity_overview"] => ({
  overall_status: "complete",
  disposition: null,
  problem_count: 1,
  complete_count: 0,
  notable_count: null,
  resolution: "unresolved",
  incomplete_reason: null,
  ...over,
});

const base: FlaggedInput = {
  extraction_flagged_at: null,
  ai_grading_status: null,
  final_score: 80,
  integrity_overview: overview({ disposition: "pass" }),
};

test("a passed check is not flagged", () => {
  assert.equal(isFlaggedSubmission(base), false);
});

test("flag_for_review flags until a teacher resolves it", () => {
  const flagged = { ...base, integrity_overview: overview({ disposition: "flag_for_review" }) };
  assert.equal(isFlaggedSubmission(flagged), true);
  assert.equal(
    isFlaggedSubmission({
      ...base,
      integrity_overview: overview({ disposition: "flag_for_review", resolution: "cleared" }),
    }),
    false,
  );
});

test("tutor_pivot is a learning signal, not a flag", () => {
  assert.equal(
    isFlaggedSubmission({ ...base, integrity_overview: overview({ disposition: "tutor_pivot" }) }),
    false,
  );
});

test("inconclusive (turn cap, or no recorded reason) and unreadable checks flag", () => {
  for (const reason of ["turn_cap", "unreadable", null] as const) {
    assert.equal(
      isFlaggedSubmission({ ...base, integrity_overview: overview({ incomplete_reason: reason }) }),
      true,
      String(reason),
    );
  }
  // Still running: no verdict yet, nothing to flag.
  assert.equal(
    isFlaggedSubmission({
      ...base,
      integrity_overview: overview({ overall_status: "in_progress" }),
    }),
    false,
  );
});

test("a check the student didn't finish never flags", () => {
  for (const reason of ["not_started", "left_partway"] as const) {
    assert.equal(
      isFlaggedSubmission({ ...base, integrity_overview: overview({ incomplete_reason: reason }) }),
      false,
      reason,
    );
  }
  // Never confirmed the reading: no check row at all.
  assert.equal(isFlaggedSubmission({ ...base, integrity_overview: null }), false);
});

test("a disputed reading flags with no check row", () => {
  assert.equal(
    isFlaggedSubmission({
      ...base,
      integrity_overview: null,
      extraction_flagged_at: "2026-10-28T10:00:00Z",
    }),
    true,
  );
});

test("an AI-grading skip flags until someone grades it, whatever the check says", () => {
  const skipped = {
    ...base,
    final_score: null,
    ai_grading_status: "skipped_unreadable",
    integrity_overview: overview({ disposition: "pass", resolution: "cleared" }),
  };
  assert.equal(isFlaggedSubmission(skipped), true);
  assert.equal(isFlaggedSubmission({ ...skipped, final_score: 70 }), false);
});
