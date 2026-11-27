/**
 * Where the margin simulator starts: every usage rate the window measured,
 * and per stage the model that actually ran. A rate the window couldn't
 * measure falls back to a stated assumption, never a silent guess. #1026
 * shipped "8 homeworks per student per month" against a measured ~1.4,
 * a sixfold overstatement of cost.
 *
 * Pure, so `npm test` pins it.
 */

import type {
  CatalogModel, Stage, SubmissionKind, UnitEconomicsData,
} from "../../lib/costsApi.ts";
import type { ModelChoice, Scenario } from "./marginModel.ts";

export const STAGES: Stage[] = ["vision", "grading", "integrity", "generation", "tutoring"];

/** The operator's own assumptions: nothing in the data says what these are. */
export const ASSUMED = {
  enrollment: 92,
  studentsPerClass: 24,
  subjects: 1,
  unitsPerYear: 8,
  schoolYearMonths: 9.5,
  annualMinimum: 3000,
  onboardingFee: 1500,
  fixedMonthly: 250,
  fairUseCap: 1.5,
} as const;

/** Used only when the window has no measurement for a rate. */
const FALLBACK_STUDENTS_PER_TEACHER = 30;

export type NumKey = Exclude<keyof Scenario, "models" | "pricePerStudent">;

export interface Default {
  value: number;
  /** measured = this scope's own window; platform = every school's, same
   *  window, where this scope has no rate of its own; assumed = nothing
   *  in the data says. */
  source: "measured" | "platform" | "assumed";
}

// Rates to the hundredth: a 0.03-a-month quiz habit is measured, not 0.
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Every numeric input's starting value, and whether it was measured. */
export function scenarioDefaults(d: UnitEconomicsData): Record<NumKey, Default> {
  const m = d.measured;
  // A rate read off a window shorter than a week is noise, not a rate —
  // the platform's included, being read off the same window.
  const own = m.window_too_short ? null : m.submissions_per_student_month;
  const platform = m.window_too_short ? null : m.platform_submissions_per_student_month;
  const rate = (k: SubmissionKind): Default =>
    own ? { value: round2(own[k]), source: "measured" }
      : platform ? { value: round2(platform[k]), source: "platform" }
        : { value: 0, source: "assumed" };
  const out = {} as Record<NumKey, Default>;
  for (const [k, v] of Object.entries(ASSUMED)) out[k as NumKey] = { value: v, source: "assumed" };
  out.homework = rate("homework");
  out.quiz = rate("quiz");
  out.test = rate("test");
  out.practice = rate("practice");
  // To a tenth, which the slider steps by: rounding to whole students
  // read a 0.4-student pilot as 0, which then divided by 1.
  out.studentsPerTeacher = m.students_per_teacher
    ? { value: round1(m.students_per_teacher), source: "measured" }
    : { value: FALLBACK_STUDENTS_PER_TEACHER, source: "assumed" };
  return out;
}

/** Neither this scope nor the platform has a submission rate for the
 *  window, so usage starts at 0 and the margin leaves out every
 *  per-submission cost — say so above the verdict. */
export function ratesUnmeasured(d: UnitEconomicsData): boolean {
  return d.measured.window_too_short || (
    d.measured.submissions_per_student_month === null
    && d.measured.platform_submissions_per_student_month === null
  );
}

/** A link that reproduces this scenario: every input pinned, so it reads
 *  the same tomorrow when the measured defaults have moved. A bare page
 *  URL carries only what was moved and keeps following the data. */
export function snapshotParams(
  base: URLSearchParams,
  nums: Record<NumKey, number>,
  models: ModelChoice,
  rateCard: number[][],
): URLSearchParams {
  const out = new URLSearchParams(base);
  for (const [k, v] of Object.entries(nums)) out.set(k, String(v));
  for (const s of STAGES) {
    const id = models[s];
    if (id) out.set(`m_${s}`, id);
  }
  out.set("rates", JSON.stringify(rateCard));
  return out;
}

/** Stages whose model (from a link) isn't one the catalog prices. */
export function unknownModels(models: ModelChoice, catalog: CatalogModel[]): Stage[] {
  const known = new Set(catalog.map((m) => m.id));
  return STAGES.filter((s) => models[s] && !known.has(models[s]!));
}

/** The model each stage starts on: what ran, else what's configured now. */
export function defaultModels(d: UnitEconomicsData): ModelChoice {
  const fallback = d.model_catalog.find((m) => m.is_configured)?.id ?? d.model_catalog[0]?.id;
  const out: ModelChoice = {};
  for (const s of STAGES) {
    const ran = d.models_in_use[s]?.catalog_id;
    const pick = ran ?? fallback;
    if (pick) out[s] = pick;
  }
  return out;
}

function tier(id: string): string | null {
  return /^claude-(fable|opus|sonnet|haiku)-/.exec(id)?.[1] ?? null;
}

/**
 * The few models worth offering for one stage, as a segmented control
 * holds them: the newest of each tier, plus what actually ran and what's
 * chosen (either can be an older model the newest-of-tier rule drops).
 * Catalog order is kept; the catalog lists each tier newest first.
 */
export function stageOptions(
  catalog: CatalogModel[], ran: string | null, chosen: string | undefined,
): CatalogModel[] {
  const seenTier = new Set<string>();
  return catalog.filter((m) => {
    const t = tier(m.id);
    const newest = t !== null && !seenTier.has(t);
    if (t) seenTier.add(t);
    return newest || m.id === ran || m.id === chosen;
  });
}

// ── The rate card ───────────────────────────────────────────────────
// The owner's v1 spreadsheet figures: $ per student per subject per
// year, tiered by enrollment. Editable on the page.

export const DEFAULT_RATE_CARD: number[][] = [
  [32, 29, 26, 23],
  [28, 25, 22, 20],
  [24, 22, 19, 17],
  [20, 18, 16, 14],
];
export const TIER_LABELS = ["1–99", "100–299", "300–599", "600+"];
const TIER_MINS = [1, 100, 300, 600];

export function tierFor(enrollment: number): number {
  for (let i = TIER_MINS.length - 1; i >= 0; i--) if (enrollment >= TIER_MINS[i]) return i;
  return 0;
}

export function subjectIndex(subjects: number): number {
  return Math.round(Math.min(Math.max(subjects, 1), 4)) - 1;
}

export function cardPriceFor(card: number[][], enrollment: number, subjects: number): number {
  return card[tierFor(enrollment)]?.[subjectIndex(subjects)] ?? DEFAULT_RATE_CARD[0][0];
}

/** The card from the URL, rows and all validated: a truncated link must
 * fall back to the default, not throw mid-render. */
export function readRateCard(raw: string | null): number[][] {
  if (!raw) return DEFAULT_RATE_CARD;
  try {
    const p: unknown = JSON.parse(raw);
    const ok = Array.isArray(p) && p.length === 4 && p.every(
      (row) => Array.isArray(row) && row.length === 4
        && row.every((v) => typeof v === "number" && Number.isFinite(v)),
    );
    return ok ? (p as number[][]) : DEFAULT_RATE_CARD;
  } catch {
    return DEFAULT_RATE_CARD;
  }
}
