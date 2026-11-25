/**
 * The simulator's arithmetic and its function→knob mapping.
 *
 * These numbers go into pricing conversations with districts, and until
 * now nothing in CI failed when any of them broke — three review rounds
 * found defects here that tests would have caught on revert. `node --test`
 * with native type-stripping, matching web/package.json; no new dependency.
 *
 * Each case names the bug it exists to prevent.
 *
 * Explicit .ts import specifiers, matching web/src/lib/*.test.ts —
 * Node's ESM resolver does not infer extensions, and both tsconfigs
 * already set allowImportingTsExtensions.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { UnitCost, UnitEconomicsData, UnitFunction } from "./api.ts";
import { featureFor } from "./llm_modes.ts";
import { computeMargin, marginAtPrice, type Scenario } from "./marginModel.ts";

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-4-6";
const HAIKU = "claude-haiku-5-5";

function unit(kind: string, over: Partial<UnitCost> = {}): UnitCost {
  return {
    kind,
    label: kind.split(":")[1] ?? kind,
    denominator: "",
    n: 50,
    cost_median: 0.1,
    cost_mean: 0.1,
    cost_p90: 0.2,
    cost_total: 5,
    sufficient: true,
    window_too_short: false,
    ...over,
  };
}

function fn(
  name: string,
  reprice: Record<string, number | null>,
  over: Partial<UnitFunction> = {},
): UnitFunction {
  return {
    function: name,
    models: [OPUS],
    measured_model: OPUS,
    measured_catalog_id: OPUS,
    calls_per_unit: 1,
    cost_per_unit: reprice[OPUS] ?? 0,
    tokens: { input: 1000, output: 200, cache_read: 0, cache_write: 0 },
    reprice,
    self_reprice: reprice[OPUS] ?? 0,
    ...over,
  };
}

function data(over: Partial<UnitEconomicsData> = {}): UnitEconomicsData {
  return {
    window: {
      start: "", end: "", days: 30, basis: "model_cutover", cutover_model: OPUS,
    },
    units: [
      unit("submission:homework", { cost_mean: 0.3, cost_median: 0.3 }),
      unit("submission:quiz", { n: 0, cost_mean: null, cost_median: null, sufficient: false }),
      unit("submission:test", { n: 0, cost_mean: null, cost_median: null, sufficient: false }),
      unit("submission:practice", { n: 0, cost_mean: null, cost_median: null, sufficient: false }),
      unit("generation:unit", { n: 0, cost_mean: null, cost_median: null, sufficient: false }),
      unit("residual:teacher", { n: 0, cost_mean: 0, cost_median: 0, sufficient: false }),
      unit("residual:student", { n: 0, cost_mean: 0, cost_median: 0, sufficient: false }),
    ],
    functions_by_unit: {
      "submission:homework": [
        fn("integrity_extract", { [OPUS]: 0.3, [SONNET]: 0.1, [HAIKU]: 0.01 }),
      ],
    },
    reconciliation: {
      call_count: 100, recorded_usd: 10, recomputed_usd: 10, gap_pct: 0,
      unpriced_models: [], by_model: [],
    },
    teacher_student_ratio: { teachers: 3, students: 90, students_per_teacher: 30 },
    model_catalog: [],
    min_sample: 5,
    ...over,
  };
}

function scenario(over: Partial<Scenario> = {}): Scenario {
  return {
    enrollment: 92,
    studentsPerClass: 24,
    studentsPerTeacher: 30,
    subjects: 1,
    homework: 1,
    quiz: 0,
    test: 0,
    practice: 0,
    unitsPerYear: 0,
    schoolYearMonths: 9.5,
    pricePerStudent: 28,
    annualMinimum: 0,
    onboardingFee: 0,
    fixedMonthly: 0,
    fairUseCap: 1.5,
    models: { vision: OPUS },
    ...over,
  };
}

// ── Degenerate inputs must never report a flattering margin ──────────

test("subjects = 0 does not report a 100% margin", () => {
  const r = computeMargin(data(), scenario({ subjects: 0, annualMinimum: 3000 }));
  assert.ok(
    r.marginPct !== null && r.marginPct < 100,
    `expected a real margin, got ${r.marginPct}%`,
  );
});

test("negative enrollment does not report above 100%", () => {
  const r = computeMargin(
    data(),
    scenario({ enrollment: -100, annualMinimum: 3000 }),
  );
  assert.ok(r.marginPct !== null && r.marginPct <= 100);
});

test("a negative volume cannot flip a cost line negative", () => {
  // `min={0}` is a markup hint; the scenario is rebuilt from the URL,
  // where it has no reach at all.
  const r = computeMargin(data(), scenario({ homework: -100 }));
  assert.ok(r.costPerStudentMonth >= 0, `got ${r.costPerStudentMonth}`);
});

test("a negative school year cannot flip the annual cost negative", () => {
  const r = computeMargin(data(), scenario({ schoolYearMonths: -9.5 }));
  assert.ok(r.costPerStudentYear >= 0);
});

// ── The margin tile and the sweep must agree ──────────────────────────

test("the price sweep applies the annual minimum the tile applies", () => {
  // 92 x 1 x $28 = $2,576, under a $3,000 floor. Ignoring the floor made
  // the $28 bar disagree with the tile on the shipped defaults.
  const s = scenario({ annualMinimum: 3000, pricePerStudent: 28 });
  const r = computeMargin(data(), s);
  assert.equal(
    Math.round((marginAtPrice(r.costPerStudentYear, 28, s) ?? 0) * 10),
    Math.round((r.marginPct ?? 0) * 10),
  );
});

// ── Every knob must move the number ───────────────────────────────────

test("changing the model for a feature changes the cost", () => {
  const cheap = computeMargin(data(), scenario({ models: { vision: HAIKU } }));
  const dear = computeMargin(data(), scenario({ models: { vision: OPUS } }));
  assert.ok(
    cheap.costPerStudentMonth < dear.costPerStudentMonth,
    "the vision knob must move the headline",
  );
});

test("the tutoring knob moves the self-study line", () => {
  // Both residual lines once read the measured mean and ignored their
  // profiles entirely, so this knob did nothing at all.
  const d = data({
    units: [
      ...data().units.filter((u) => u.kind !== "residual:student"),
      unit("residual:student", { n: 40, cost_mean: 0.3, cost_median: 0.3 }),
    ],
    functions_by_unit: {
      "residual:student": [
        fn("step_chat", { [OPUS]: 0.3, [SONNET]: 0.1, [HAIKU]: 0.01 }),
      ],
    },
  });
  const dear = computeMargin(d, scenario({ homework: 0, models: { tutoring: OPUS } }));
  const cheap = computeMargin(d, scenario({ homework: 0, models: { tutoring: HAIKU } }));
  assert.ok(
    cheap.costPerStudentMonth < dear.costPerStudentMonth,
    "tutoring knob is inert",
  );
});

// ── A window too short to extrapolate must not drive the headline ─────

test("a short-window residual rate is excluded, not consumed", () => {
  // cost / users / MONTHS explodes as months -> 0. Half an hour after a
  // model switch this reported $288/student/month and dragged the margin
  // tile to -8,330%.
  const d = data({
    units: [
      ...data().units.filter((u) => u.kind !== "residual:student"),
      unit("residual:student", {
        n: 50, cost_mean: 288, cost_median: 288,
        sufficient: false, window_too_short: true,
      }),
    ],
  });
  const r = computeMargin(d, scenario({ homework: 0 }));
  assert.equal(r.costPerStudentMonth, 0);
  assert.ok(r.excluded.includes("self-study"), `excluded: ${r.excluded}`);
});

test("a short window is not reported as a thin sample", () => {
  // Different cause, different fix: more data vs. a longer window.
  const d = data({
    units: [
      ...data().units.filter((u) => u.kind !== "residual:student"),
      unit("residual:student", {
        n: 50, cost_mean: 288, cost_median: 288,
        sufficient: false, window_too_short: true,
      }),
    ],
  });
  const line = computeMargin(d, scenario({ homework: 0 })).lines.find(
    (l) => l.key === "residual:student",
  );
  assert.ok(line);
  assert.equal(line!.shortWindow, true);
  assert.equal(line!.thin, false, "50 observations is not a thin sample");
});

// ── An absent bucket must not read as free ────────────────────────────

test("a bucket with no measurement contributes nothing and is not free", () => {
  const r = computeMargin(data(), scenario({ quiz: 5 }));
  const quiz = r.lines.find((l) => l.key === "submission:quiz");
  assert.ok(quiz, "quiz line must exist even with no measurement");
  assert.equal(quiz!.perStudentMonth, 0);
  assert.equal(quiz!.thin, true, "must be flagged, not silently zero");
});

// ── featureFor: a function's knob depends on where it was measured ────

test("decompose is generation work inside a generation job", () => {
  // assignment_generation calls decompose_problem WITH a job id.
  assert.equal(featureFor("decompose", "generation:unit"), "generation");
});

test("decompose is tutoring everywhere else", () => {
  // practice.py and session.py call the same helper for self-study.
  assert.equal(featureFor("decompose", "residual:student"), "tutoring");
  assert.equal(featureFor("decompose", "submission:homework"), "tutoring");
});

test("a derived figure-read follows the family it was measured in", () => {
  // construction_figures logs `${mode}_facts_a`; the prefix can be a
  // generation mode OR bank_chat, so a flat suffix map sent a teacher's
  // bank-chat figure reads to the Generate-problems knob.
  assert.equal(featureFor("generate_questions_facts_a", "generation:unit"), "generation");
  assert.equal(featureFor("bank_chat_facts_a", "residual:teacher"), "tutoring");
  assert.equal(featureFor("bank_chat_facts_b", "residual:teacher"), "tutoring");
});

test("answer_equivalence is tutoring despite the generic name", () => {
  assert.equal(featureFor("answer_equivalence", "submission:homework"), "tutoring");
});

test("graph and drawing checks sit under grading", () => {
  // All four log with a submission_id, so falling through to "other" kept
  // the "could not be repriced" banner permanently lit.
  for (const f of [
    "classify_requires_drawing", "graph_checklist", "drawing_check", "graph_feedback",
  ]) {
    assert.equal(featureFor(f, "submission:homework"), "grading", f);
  }
});

test("an unmapped function is 'other', never silently priced", () => {
  assert.equal(featureFor("some_new_mode_we_added", "submission:homework"), "other");
});

// ── Review round 4 ───────────────────────────────────────────────────

test("an unmapped function is never silently repriced", () => {
  // featureFor returns "other" for anything unmapped, and the picker has
  // no row for it — so a model chosen for "other" would be invisible and
  // unchangeable. The leg must fall back to measured cost and say so.
  const d = data({
    functions_by_unit: {
      "submission:homework": [
        fn("some_mode_nobody_mapped", { [OPUS]: 0.9, [HAIKU]: 0.01 }),
      ],
    },
  });
  const r = computeMargin(d, scenario({ models: { other: HAIKU } }));
  const hw = r.lines.find((l) => l.key === "submission:homework");
  assert.ok(hw);
  assert.equal(
    hw!.perStudentMonth,
    0.9,
    "an unmapped leg must hold its measured cost, not be repriced",
  );
  assert.equal(r.anyUnpriced, true, "and must light the banner");
});

test("an unpriceable generation leg lights the banner", () => {
  // anyUnpriced used to be assigned only inside the submission loop, so
  // a generation / teacher / self-study leg that could not be repriced
  // left the knob inert with nothing on screen explaining why.
  const d = data({
    units: [
      ...data().units.filter((u) => u.kind !== "generation:unit"),
      unit("generation:unit", { n: 10, cost_mean: 1, cost_median: 1 }),
    ],
    functions_by_unit: {
      // A model retired from the catalog reprices to null for every
      // target, which is what a 90-day window can contain.
      "generation:unit": [
        fn("generate_questions", { [OPUS]: null, [HAIKU]: null }, {
          cost_per_unit: 1,
          self_reprice: null,
        }),
      ],
    },
  });
  const r = computeMargin(
    d,
    scenario({ homework: 0, unitsPerYear: 8, models: { generation: OPUS } }),
  );
  assert.equal(r.anyUnpriced, true);
});

test("a row that is both thin and short reports BOTH", () => {
  // Clearing `thin` whenever the window was short hid a 2-teacher sample
  // for as long as the short-window flag was up. The two need different
  // actions: collect more data, or widen the window.
  const d = data({
    units: [
      ...data().units.filter((u) => u.kind !== "residual:teacher"),
      unit("residual:teacher", {
        n: 2, cost_mean: 500, cost_median: 500,
        sufficient: false, window_too_short: true,
      }),
    ],
  });
  const r = computeMargin(d, scenario({ homework: 0 }));
  const line = r.lines.find((l) => l.key === "residual:teacher");
  assert.ok(line);
  assert.equal(line!.shortWindow, true, "the window is short");
  assert.equal(line!.thin, true, "and 2 observations is also thin");
  assert.equal(r.anyThin, true, "so the thin warning must still fire");
});

test("a well-sampled short-window row is not called thin", () => {
  const d = data({
    units: [
      ...data().units.filter((u) => u.kind !== "residual:student"),
      unit("residual:student", {
        n: 50, cost_mean: 288, cost_median: 288,
        sufficient: false, window_too_short: true,
      }),
    ],
  });
  const line = computeMargin(d, scenario({ homework: 0 })).lines.find(
    (l) => l.key === "residual:student",
  );
  assert.ok(line);
  assert.equal(line!.thin, false, "50 observations is not a thin sample");
});
