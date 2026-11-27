/**
 * Where the simulator starts. Each case names the bug it prevents.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogModel, UnitEconomicsData } from "../../lib/costsApi.ts";
import {
  DEFAULT_RATE_CARD, cardPriceFor, defaultModels, ratesUnmeasured, readRateCard, scenarioDefaults,
  snapshotParams, stageOptions, unknownModels,
} from "./marginScenario.ts";
import { windowDays } from "./unitWindows.ts";

const model = (id: string, is_configured = false): CatalogModel => ({
  id, label: id, input_per_mtok: 1, output_per_mtok: 1, is_configured,
});

const CATALOG = [
  model("claude-fable-5-1"), model("claude-opus-5-5", true), model("claude-opus-5"),
  model("claude-sonnet-5-5"), model("claude-sonnet-5"), model("claude-sonnet-4-6"),
  model("claude-haiku-5-5"), model("claude-haiku-4-5"),
];

const none = { model: null, catalog_id: null, cost_usd: 0 };

function data(over: Partial<UnitEconomicsData["measured"]> = {}): UnitEconomicsData {
  return {
    window: { start: "", end: "", days: 30, basis: "model_cutover", cutover_model: null },
    units: [],
    functions_by_unit: {},
    deleted_submissions: { calls: 0, cost_usd: 0, per_unit_usd: 0, spread_over: 0 },
    deleted_generation_jobs: { calls: 0, cost_usd: 0, per_unit_usd: 0, spread_over: 0 },
    reconciliation: {
      call_count: 0, recorded_usd: 0, recomputed_usd: 0, gap_pct: 0, unpriced_models: [], by_model: [],
    },
    measured: {
      window_too_short: false, active_students: 90,
      submissions: { homework: 126, quiz: 9, test: 0, practice: 0 },
      submissions_per_student_month: { homework: 1.4049, quiz: 0.1, test: 0, practice: 0 },
      platform_submissions_per_student_month: { homework: 1.4049, quiz: 0.1, test: 0, practice: 0 },
      teachers: 3, students: 92, active_teachers: 3, students_per_teacher: 30.67,
      ...over,
    },
    models_in_use: {
      vision: { label: "Read handwriting", model: "claude-opus-5-5", catalog_id: "claude-opus-5-5", cost_usd: 40 },
      grading: { label: "Grade", model: "claude-sonnet-4-6-20260101", catalog_id: "claude-sonnet-4-6", cost_usd: 9 },
      integrity: { label: "Understanding check", ...none },
      generation: { label: "Generate problems", ...none },
      tutoring: { label: "Tutor + chat", ...none },
    },
    model_catalog: CATALOG,
    min_sample: 5,
  };
}

test("homeworks per month start at the measured rate, not a hardcoded 8", () => {
  const d = scenarioDefaults(data());
  assert.deepEqual(d.homework, { value: 1.4, source: "measured" });
  assert.deepEqual(d.quiz, { value: 0.1, source: "measured" });
  // A rare quiz habit is a measured rate, not a measured zero.
  assert.deepEqual(scenarioDefaults(data({
    submissions_per_student_month: { homework: 1.4, quiz: 0.0326, test: 0, practice: 0 },
  })).quiz, { value: 0.03, source: "measured" });
  assert.deepEqual(d.studentsPerTeacher, { value: 30.7, source: "measured" });
});

test("a short window's rates are not taken as measured", () => {
  // Thirty minutes after a cutover, one submission is "30 a month".
  const d = scenarioDefaults(data({ window_too_short: true }));
  assert.deepEqual(d.homework, { value: 0, source: "assumed" });
});

test("no submissions at all is unmeasured, not a measured zero", () => {
  const d = scenarioDefaults(data({
    submissions_per_student_month: null, platform_submissions_per_student_month: null,
    students_per_teacher: null,
  }));
  assert.equal(d.homework.source, "assumed");
  assert.deepEqual(d.studentsPerTeacher, { value: 30, source: "assumed" });
});

test("assumptions are labelled as assumptions", () => {
  const d = scenarioDefaults(data());
  assert.deepEqual(d.unitsPerYear, { value: 8, source: "assumed" });
  assert.deepEqual(d.enrollment, { value: 92, source: "assumed" });
});

test("each stage starts on the model that actually ran, by catalog id", () => {
  // grading's raw model carries a date pin no option matches; the
  // catalog id does.
  const m = defaultModels(data());
  assert.equal(m.vision, "claude-opus-5-5");
  assert.equal(m.grading, "claude-sonnet-4-6");
  // Nothing ran: the configured model, not the catalog's first entry.
  assert.equal(m.tutoring, "claude-opus-5-5");
});

test("a stage offers the newest of each tier plus what ran", () => {
  const ids = stageOptions(CATALOG, "claude-sonnet-4-6", undefined).map((m) => m.id);
  assert.deepEqual(ids, [
    "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-sonnet-4-6", "claude-haiku-5-5",
  ]);
});

test("a chosen older model stays offered, so the control can show it", () => {
  const ids = stageOptions(CATALOG, null, "claude-haiku-4-5").map((m) => m.id);
  assert.ok(ids.includes("claude-haiku-4-5"));
  assert.equal(ids.length, 5);
});

test("a truncated rate card in a link falls back, never throws mid-render", () => {
  assert.equal(readRateCard("[1,2,3,4]"), DEFAULT_RATE_CARD);
  assert.equal(readRateCard("not json"), DEFAULT_RATE_CARD);
  assert.deepEqual(readRateCard(JSON.stringify([[1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3], [4, 4, 4, 4]]))[3], [4, 4, 4, 4]);
});

test("the card prices by enrollment tier and subject count", () => {
  assert.equal(cardPriceFor(DEFAULT_RATE_CARD, 92, 1), 32);
  assert.equal(cardPriceFor(DEFAULT_RATE_CARD, 300, 2), 22);
  assert.equal(cardPriceFor(DEFAULT_RATE_CARD, 5000, 9), 14);
});

test("no measured rates says so only when the platform has none either", () => {
  assert.equal(ratesUnmeasured(data()), false);
  assert.equal(ratesUnmeasured(data({ submissions_per_student_month: null })), false);
  assert.equal(ratesUnmeasured(data({
    submissions_per_student_month: null, platform_submissions_per_student_month: null,
  })), true);
  assert.equal(ratesUnmeasured(data({ window_too_short: true })), true);
});

test("a scope with no rate starts at the platform average, labelled so", () => {
  const d = scenarioDefaults(data({
    submissions_per_student_month: null,
    platform_submissions_per_student_month: { homework: 2.345, quiz: 0, test: 0.5, practice: 0 },
  }));
  assert.deepEqual(d.homework, { value: 2.35, source: "platform" });
  assert.deepEqual(d.test, { value: 0.5, source: "platform" });
  // A scope's own rate always wins over the platform's.
  assert.equal(scenarioDefaults(data()).homework.source, "measured");
});

test("students per teacher keeps its tenth: a small pilot isn't 0", () => {
  assert.equal(scenarioDefaults(data({ students_per_teacher: 0.4 })).studentsPerTeacher.value, 0.4);
});

test("a copied link pins every input; a bare one carries only what moved", () => {
  const base = new URLSearchParams("tab=margin&homework=3");
  const nums = { ...Object.fromEntries(Object.entries(scenarioDefaults(data())).map(([k, v]) => [k, v.value])), homework: 3 };
  const q = snapshotParams(base, nums as never, { vision: "claude-opus-5-5", grading: "claude-haiku-4-5" }, DEFAULT_RATE_CARD);
  assert.equal(q.get("tab"), "margin");
  assert.equal(q.get("homework"), "3");
  assert.equal(q.get("quiz"), "0.1", "an untouched input is pinned at its value now");
  assert.equal(q.get("enrollment"), "92");
  assert.equal(q.get("m_vision"), "claude-opus-5-5");
  assert.equal(q.get("m_grading"), "claude-haiku-4-5");
  assert.deepEqual(JSON.parse(q.get("rates")!), DEFAULT_RATE_CARD);
  assert.equal(base.get("quiz"), null, "the page's own URL is left alone");
});

test("a link's model the catalog doesn't price is named", () => {
  assert.deepEqual(unknownModels({ vision: "claude-opus-5-5", grading: "gpt-9" }, CATALOG), ["grading"]);
  assert.deepEqual(unknownModels({ vision: "claude-opus-5-5" }, CATALOG), []);
});

test("a days value the picker doesn't offer reads as the default window", () => {
  for (const bad of ["abc", "0", "5", "-30", null]) assert.equal(windowDays(bad), "");
  for (const ok of ["7", "30", "90", ""]) assert.equal(windowDays(ok), ok);
});
