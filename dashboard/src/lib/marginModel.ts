/**
 * Scenario arithmetic for the margin simulator.
 *
 * Deliberately contains NO repricing. Turning a measured call into what
 * it would cost on another model needs tokenizer rescaling, that model's
 * own cache-read multiplier and Haiku 5.5's 100k-token price cliff; all
 * of that lives in api/core/model_pricing.py and arrives precomputed in
 * `UnitFunction.reprice`. A second implementation here would drift from
 * the tested one, and the drift would show up as a wrong margin in front
 * of a district.
 *
 * What IS here is the part that depends on the scenario: how often each
 * thing happens, and what divides by what.
 *
 *   per-submission cost  x  submissions      — scales with every student
 *   per-unit generation  /  class size       — paid once, shared
 *   teacher-side AI      /  students/teacher — paid per teacher
 *
 * That asymmetry is the whole point: generation and teacher-side AI get
 * cheaper per student as classes grow, reading and grading does not.
 */

import type { UnitCost, UnitEconomicsData, UnitFunction } from "./api";
import { featureFor } from "./llm_modes";

/** Which model the operator picked for each simulator knob. */
export type ModelChoice = Record<string, string>;

export interface Scenario {
  enrollment: number;
  studentsPerClass: number;
  studentsPerTeacher: number;
  subjects: number;
  /** Per student per month. */
  homework: number;
  quiz: number;
  test: number;
  practice: number;
  /** Per class per YEAR — generation is a unit-level cost. */
  unitsPerYear: number;
  schoolYearMonths: number;
  pricePerStudent: number;
  annualMinimum: number;
  onboardingFee: number;
  fixedMonthly: number;
  fairUseCap: number;
  models: ModelChoice;
}

export interface CostLine {
  key: string;
  label: string;
  /** Dollars per student per month. */
  perStudentMonth: number;
  /** True when the measurement behind it was too thin to trust. */
  thin: boolean;
  /** True when no model in the catalog could price it. */
  unpriced: boolean;
}

export interface MarginResult {
  lines: CostLine[];
  /** Lines excluded from the total because the window cannot support
   *  them. Reported so the page says what it left out. */
  excluded: string[];
  costPerStudentMonth: number;
  costPerStudentYear: number;
  revenue: number;
  grossProfit: number;
  /** null when revenue is 0 — undefined, not -Infinity. */
  marginPct: number | null;
  yearOneNetCash: number;
  capHeadroom: number | null;
  overCap: boolean;
  /** Measured vs repriced on the models we actually ran. The trust check. */
  trustDeltaPct: number | null;
  /** How many function legs the trust check could not cover. */
  trustUncheckedLegs: number;
  anyThin: boolean;
  anyUnpriced: boolean;
}

const SUBMISSION_KINDS = ["homework", "quiz", "test", "practice"] as const;

function unitOf(data: UnitEconomicsData, kind: string): UnitCost | undefined {
  return data.units.find((u) => u.kind === kind);
}

/**
 * Cost of one unit under the operator's model picks.
 *
 * Sums the per-function repriced figures rather than the measured total,
 * so changing a model actually moves the number. Falls back to the
 * measured cost for a function the catalog could not price, and reports
 * that it did.
 */
function repricedUnitCost(
  fns: UnitFunction[] | undefined,
  models: ModelChoice,
  // Needed because a function's knob can depend on the family it was
  // measured in — `decompose` is generation work inside a generation
  // job and tutoring everywhere else.
  unitKind: string,
): { cost: number; unpriced: boolean } {
  if (!fns || fns.length === 0) return { cost: 0, unpriced: false };
  let cost = 0;
  let unpriced = false;
  for (const fn of fns) {
    const chosen = models[featureFor(fn.function, unitKind)];
    const repriced = chosen ? fn.reprice[chosen] : undefined;
    if (repriced === undefined || repriced === null) {
      cost += fn.cost_per_unit;
      unpriced = true;
    } else {
      cost += repriced;
    }
  }
  return { cost, unpriced };
}

/** What the unit costs on the models we ACTUALLY ran — the trust check. */
function measuredUnitCost(fns: UnitFunction[] | undefined): number {
  if (!fns) return 0;
  return fns.reduce((acc, f) => acc + f.cost_per_unit, 0);
}

export function computeMargin(
  data: UnitEconomicsData,
  s: Scenario,
): MarginResult {
  const lines: CostLine[] = [];
  let anyUnpriced = false;
  let anyThin = false;

  // 1. Per-submission work — paid for every student, every time.
  for (const kind of SUBMISSION_KINDS) {
    const perMonth = s[kind];
    const unit = unitOf(data, `submission:${kind}`);
    const fns = data.functions_by_unit[`submission:${kind}`];
    const { cost, unpriced } = repricedUnitCost(
      fns,
      s.models,
      `submission:${kind}`,
    );
    // No measurement at all → contribute nothing, but say so rather
    // than let a missing bucket read as "free".
    const thin = !unit || !unit.sufficient;
    if (perMonth > 0 && (unpriced || thin)) {
      anyUnpriced = anyUnpriced || unpriced;
      anyThin = anyThin || thin;
    }
    lines.push({
      key: `submission:${kind}`,
      label: kind,
      perStudentMonth: cost * perMonth,
      thin: thin && perMonth > 0,
      unpriced: unpriced && perMonth > 0,
    });
  }

  // 2. Generation — paid once per teaching unit, shared by the class.
  const genFns = data.functions_by_unit["generation:unit"];
  const genUnit = unitOf(data, "generation:unit");
  const gen = repricedUnitCost(genFns, s.models, "generation:unit");
  // The endpoint only returns a measured total for generation (there is
  // no per-function profile when no generation ran), so fall back to it.
  const genPerUnit = gen.cost > 0 ? gen.cost : (genUnit?.cost_median ?? 0);
  const classSize = Math.max(s.studentsPerClass, 1);
  const unitsPerMonth = s.unitsPerYear / Math.max(s.schoolYearMonths, 1);
  const genThin = !genUnit || !genUnit.sufficient;
  lines.push({
    key: "generation:unit",
    label: "unit generation",
    perStudentMonth: (genPerUnit / classSize) * unitsPerMonth,
    thin: genThin && s.unitsPerYear > 0,
    unpriced: gen.unpriced && s.unitsPerYear > 0,
  });
  anyThin = anyThin || (genThin && s.unitsPerYear > 0);

  // 3. Teacher-side AI — per teacher, divided across their students.
  //
  // Repriced like everything else. Reading cost_mean straight off the
  // measured unit left the Tutor + chat knob completely inert: the
  // operator moved tutoring from Opus to Haiku and not one figure on the
  // page changed.
  const teacher = unitOf(data, "residual:teacher");
  const teacherFns = data.functions_by_unit["residual:teacher"];
  const teacherCost = repricedUnitCost(
    teacherFns,
    s.models,
    "residual:teacher",
  );
  const perTeacherMonth =
    teacherFns && teacherFns.length > 0
      ? teacherCost.cost
      : (teacher?.cost_mean ?? 0);
  lines.push({
    key: "residual:teacher",
    label: "teacher-side AI",
    perStudentMonth: perTeacherMonth / Math.max(s.studentsPerTeacher, 1),
    thin: !teacher || !teacher.sufficient,
    unpriced: teacherCost.unpriced,
  });

  // 4. Self-study — already per student per month.
  const student = unitOf(data, "residual:student");
  const studentFns = data.functions_by_unit["residual:student"];
  const studentCost = repricedUnitCost(
    studentFns,
    s.models,
    "residual:student",
  );
  lines.push({
    key: "residual:student",
    label: "self-study",
    perStudentMonth:
      studentFns && studentFns.length > 0
        ? studentCost.cost
        : (student?.cost_mean ?? 0),
    thin: !student || !student.sufficient,
    unpriced: studentCost.unpriced,
  });

  anyThin = anyThin || lines.some((l) => l.thin);

  // A residual rate is cost / users / MONTHS. On a window far shorter
  // than a month that divisor goes to ~0 and the rate explodes: half an
  // hour after a model switch — the state of the DEFAULT window right
  // after a cutover — one student with $0.20 of tutoring reports $288 per
  // student per month, which drags the margin tile to -8,330%.
  //
  // Round 1 flagged it; the arithmetic still consumed it. A number that
  // absurd is not "directional", so it is left out of the total and
  // named instead.
  const excluded: string[] = [];
  for (const line of lines) {
    const unit = unitOf(data, line.key);
    if (unit?.window_too_short && line.perStudentMonth > 0) {
      excluded.push(line.label);
      line.perStudentMonth = 0;
    }
  }

  const costPerStudentMonth = lines.reduce((a, l) => a + l.perStudentMonth, 0);
  // Clamped with the rest: a negative school year flips the sign of
  // every cost and reports a margin above 100%.
  const costPerStudentYear = costPerStudentMonth * Math.max(s.schoolYearMonths, 0);

  // Revenue: priced per student per SUBJECT, with a floor.
  //
  // Clamped first. With subjects = 0, totalCost collapses to 0 while
  // revenue still floors to the annual minimum, and the page reports a
  // 100% gross margin next to a nonzero cost-per-student tile — the exact
  // "empty bucket reads as free" failure the backend takes care to avoid.
  // A negative enrollment reports above 100%. Both are one keystroke away
  // in a bare number input, and both survive the URL round-trip.
  const enrollment = Math.max(s.enrollment, 0);
  const subjects = Math.max(s.subjects, 1);
  const computed = enrollment * subjects * s.pricePerStudent;
  const revenue = Math.max(s.annualMinimum, computed);
  const totalCost = costPerStudentYear * enrollment * subjects;
  const grossProfit = revenue - totalCost;
  const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : null;
  const yearOneNetCash =
    revenue + s.onboardingFee - totalCost - s.fixedMonthly * 12;

  const capHeadroom =
    costPerStudentMonth > 0 ? s.fairUseCap / costPerStudentMonth : null;

  // Trust check: every leg priced on the model it actually ran on,
  // compared with what we actually paid. The backend computes it
  // (`self_reprice`) because only it knows the per-model split — and
  // unlike "look up the measured model in the reprice map" it stays a
  // true identity when a function spans several models.
  let measured = 0;
  let repricedAtMeasured = 0;
  let unchecked = 0;
  for (const [, fns] of Object.entries(data.functions_by_unit)) {
    for (const fn of fns) {
      if (fn.self_reprice === null || fn.self_reprice === undefined) {
        // Nothing to compare: leave BOTH sides alone rather than adding
        // a matching pair that dilutes the delta toward zero.
        unchecked += 1;
        continue;
      }
      measured += fn.cost_per_unit;
      repricedAtMeasured += fn.self_reprice;
    }
  }

  const trustDeltaPct =
    measured > 0 ? ((repricedAtMeasured - measured) / measured) * 100 : null;

  return {
    lines,
    excluded,
    costPerStudentMonth,
    costPerStudentYear,
    revenue,
    grossProfit,
    marginPct,
    yearOneNetCash,
    capHeadroom,
    overCap: costPerStudentMonth > s.fairUseCap,
    trustDeltaPct,
    // Legs the check could not cover. A delta computed over a subset is
    // weaker evidence, and the page says so rather than implying the
    // whole page was verified.
    trustUncheckedLegs: unchecked,
    anyThin,
    anyUnpriced,
  };
}

/** Margin at an arbitrary price, for the sensitivity sweep.
 *
 * Takes the whole scenario, not just a unit cost, so it applies the same
 * annual minimum the headline tile does. Without it the two disagreed at
 * the same price on the shipped defaults: 92 students x 1 subject x $28
 * is $2,576, under the $3,000 floor, so the tile read 75.5% where the
 * $28 bar read 71.4%.
 */
export function marginAtPrice(
  costPerStudentYear: number,
  price: number,
  s: Pick<Scenario, "enrollment" | "subjects" | "annualMinimum">,
): number | null {
  if (price <= 0) return null;
  const enrollment = Math.max(s.enrollment, 0);
  const subjects = Math.max(s.subjects, 1);
  const revenue = Math.max(s.annualMinimum, enrollment * subjects * price);
  if (revenue <= 0) return null;
  const cost = costPerStudentYear * enrollment * subjects;
  return ((revenue - cost) / revenue) * 100;
}

export { SUBMISSION_KINDS, measuredUnitCost };
