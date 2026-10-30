// Unit tests for the student homework page's routing. Plain Node (>=22.6):
//   node --experimental-strip-types --test src/lib/homework-route.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IntegrityStateResponse, StudentSubmission } from "./api.ts";
import { routeSubmittedHomework } from "./homework-route.ts";

const READING = {
  steps: [{ problem_position: 1, step_num: 1, latex: "x = 2" }],
  final_answers: [{ problem_position: 1, answer_latex: "2" }],
  confidence: 0.93,
} as unknown as StudentSubmission["extraction"];
const FILES = [{ data: "x", media_type: "image/png" }] as StudentSubmission["files"];

function sub(over: Partial<StudentSubmission>): StudentSubmission {
  return {
    submission_id: "s1",
    submitted_at: "2026-10-29T12:00:00Z",
    is_late: false,
    files: FILES,
    final_answers: {},
    extraction: READING,
    extraction_confirmed_at: null,
    extraction_flagged_at: null,
    integrity_check_enabled: true,
    ai_grading_enabled: true,
    ...over,
  };
}

function state(overall_status: string): IntegrityStateResponse {
  return { overall_status } as IntegrityStateResponse;
}

const CONFIRMED = "2026-10-29T12:01:00Z";

// No published grade unless a test says so.
const route = (
  s: StudentSubmission | null,
  i: IntegrityStateResponse | null,
  gradePublished = false,
) => routeSubmittedHomework(s, i, gradePublished);

describe("routeSubmittedHomework", () => {
  it("shows the confirm screen while the reading waits on the student", () => {
    const mode = route(sub({}), state("extracting"));
    assert.equal(mode.kind, "integrity_confirm");
    assert.equal(mode.kind === "integrity_confirm" && mode.integrityCheckEnabled, true);
  });

  // The prod bug: check off + AI grading on. The integrity endpoint says
  // "no_check", and the page used to leave the confirm screen mounted on
  // "Saving…" until a reload.
  it("check off, AI grading on: a confirmed reading lands on the submitted view", () => {
    const confirmed = sub({
      extraction_confirmed_at: CONFIRMED,
      integrity_check_enabled: false,
    });
    assert.deepEqual(route(confirmed, state("no_check")), { kind: "homework" });
  });

  it("check on: a confirmed reading waits for the check, then opens the chat", () => {
    const confirmed = sub({ extraction_confirmed_at: CONFIRMED });
    assert.deepEqual(route(confirmed, state("extracting")), { kind: "integrity_pending" });
    assert.deepEqual(route(confirmed, state("awaiting_student")), { kind: "integrity_chat" });
    assert.deepEqual(route(confirmed, state("in_progress")), { kind: "integrity_chat" });
  });

  it("check on, AI grading off: a confirmed reading still opens the chat", () => {
    const confirmed = sub({ extraction_confirmed_at: CONFIRMED, ai_grading_enabled: false });
    assert.deepEqual(route(confirmed, state("awaiting_student")), { kind: "integrity_chat" });
  });

  it("check and AI grading both off: no reading ever comes, so no spinner", () => {
    const plain = sub({
      extraction: null,
      integrity_check_enabled: false,
      ai_grading_enabled: false,
    });
    assert.deepEqual(route(plain, state("no_check")), { kind: "homework" });
  });

  it("a finished or unreadable check lands on the submitted view", () => {
    const confirmed = sub({ extraction_confirmed_at: CONFIRMED });
    for (const s of ["complete", "skipped_unreadable"]) {
      assert.deepEqual(route(confirmed, state(s)), { kind: "homework" });
    }
  });

  it("check-state fetch failed after confirm: preparing (it polls) with the check on, else submitted", () => {
    const confirmed = sub({ extraction_confirmed_at: CONFIRMED });
    assert.deepEqual(route(confirmed, null), { kind: "integrity_pending" });
    const checkOff = sub({ extraction_confirmed_at: CONFIRMED, integrity_check_enabled: false });
    assert.deepEqual(route(checkOff, null), { kind: "homework" });
  });

  it("a published grade skips the confirm screen and the reading spinner", () => {
    assert.deepEqual(route(sub({}), state("extracting"), true), { kind: "homework" });
    assert.deepEqual(route(sub({ extraction: null }), state("extracting"), true), { kind: "homework" });
  });

  it("both toggles switched off since submit: an unconfirmed reading waits on nothing", () => {
    const off = sub({ integrity_check_enabled: false, ai_grading_enabled: false });
    assert.deepEqual(route(off, state("no_check")), { kind: "homework" });
  });

  it("still reading: preparing spinner", () => {
    assert.deepEqual(
      route(sub({ extraction: null }), state("extracting")),
      { kind: "integrity_pending" },
    );
  });

  it("flagged beats everything", () => {
    const flagged = sub({ extraction_flagged_at: CONFIRMED });
    assert.deepEqual(route(flagged, state("awaiting_student")), { kind: "extraction_flagged" });
  });
});
