// The Costs page's API — /admin/spend (and, with the Unit costs and
// Margin tabs, /admin/unit-economics). Kept out of api.ts, which is past
// the file-size rule.

import { request } from "./api";

export type SpendGroup = "school" | "teacher" | "student" | "function" | "model";
export type SpendBucket = "day" | "week" | "month";

export interface SpendHeadline {
  month_start: string;
  this_month: number;
  last_month: number;
  /** Straight-line run rate to month end. */
  projected_month_end: number;
  /** The rest of the month at the slowest / fastest recent full week. */
  projected_low: number;
  projected_high: number;
  /** Full weeks the range was read from; < 2 means no range. */
  range_weeks: number;
  cost_30d: number;
  cost_prev_30d: number;
  change_30d_pct: number | null;
}

export interface SpendPoint {
  start: string;
  cost: number;
  calls: number;
  /** The current bucket, still filling. */
  partial: boolean;
}

export interface SpendRow {
  /** School / user id, function or model. null = "not tied to a …". */
  key: string | null;
  label: string;
  school_id?: string | null;
  calls: number;
  cost: number;
  share: number;
  cost_per_call: number | null;
}

export interface SpendData {
  window: { start: string; end: string };
  include_internal: boolean;
  headline: SpendHeadline;
  bucket: SpendBucket;
  series: SpendPoint[];
  group_by: SpendGroup;
  total_cost: number;
  total_calls: number;
  rows: SpendRow[];
  concentration: {
    schools_with_spend: number;
    top_school_id: string | null;
    top_school_name: string | null;
    top_school_share: number | null;
  };
}

// ── Unit economics ─────────────────────────────────────────────────
//
// What ONE homework / test / generated unit costs, as opposed to what we
// spent in total. Every repriced figure is computed server-side
// (api/routes/admin_unit_economics*.py): tokenizer rescaling, per-model
// cache multipliers and price cliffs are easy to get subtly wrong, so the
// page looks numbers up rather than recomputing them.

/** The stages a model is chosen for, as the API names them. */
export type Stage = "vision" | "grading" | "integrity" | "generation" | "tutoring";
/** A function's stage; "other" = unmapped, never repriced. */
export type Family = Stage | "other";

/** A cost per unit, by catalog model id. `null` = can't be priced. */
export type RepriceRow = Record<string, number | null>;

export interface UnitFunction {
  function: string;
  /** Which stage's model choice prices this leg. Decided server-side,
   *  where the call's context (inside a generation job or not) is known. */
  family: Family;
  models: string[];
  measured_model: string;
  /** `measured_model` resolved to a catalog id, or null if unpriced. */
  measured_catalog_id: string | null;
  calls_per_unit: number;
  cost_per_unit: number;
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
  reprice: RepriceRow;
  /** Every leg priced on the model it actually ran on: equals
   *  `cost_per_unit` when the arithmetic is sound (the trust check). */
  self_reprice: number | null;
}

export interface UnitCost {
  /** "submission:homework", "generation:unit", "residual:teacher", … */
  kind: string;
  label: string;
  denominator: string;
  n: number;
  /** null when there is no data — never 0, which would read as free. */
  cost_median: number | null;
  cost_mean: number | null;
  cost_p90: number | null;
  cost_total: number;
  /** generation:unit only — generation runs per unit, regenerations included. */
  runs_per_unit?: number | null;
  sufficient: boolean;
  /** Too short a window to read a per-month rate from. */
  window_too_short: boolean;
}

export interface CatalogModel {
  id: string;
  label: string;
  input_per_mtok: number;
  output_per_mtok: number;
  is_configured: boolean;
}

/** Calls whose submission or generation job was deleted: their cost rides
 *  pro rata on the window's surviving units. */
export interface OrphanSummary {
  calls: number;
  cost_usd: number;
  per_unit_usd: number;
  spread_over: number;
}

export type SubmissionKind = "homework" | "quiz" | "test" | "practice";

export interface Measured {
  window_too_short: boolean;
  active_students: number;
  submissions: Record<SubmissionKind, number>;
  /** null when no student submitted — unknown, not zero. */
  /** null when no one handed anything in — unknown, not four zeros. */
  submissions_per_student_month: Record<SubmissionKind, number> | null;
  teachers: number;
  students: number;
  students_per_teacher: number | null;
}

export interface StageModel {
  label: string;
  /** null when nothing in the stage ran in the window. */
  model: string | null;
  catalog_id: string | null;
  cost_usd: number;
}

export interface UnitEconomicsData {
  window: {
    start: string;
    end: string;
    days: number;
    /** "model_cutover" = since the first real call on the configured model. */
    basis: string;
    cutover_model: string | null;
  };
  units: UnitCost[];
  functions_by_unit: Record<string, UnitFunction[]>;
  deleted_submissions: OrphanSummary;
  deleted_generation_jobs: OrphanSummary;
  reconciliation: {
    call_count: number;
    recorded_usd: number;
    recomputed_usd: number;
    gap_pct: number;
    unpriced_models: string[];
    by_model: {
      model: string;
      calls: number;
      recorded_usd: number;
      recomputed_usd: number | null;
      priced: boolean;
    }[];
  };
  measured: Measured;
  /** Every stage, in picker order, with the model that carried its spend. */
  models_in_use: Record<Stage, StageModel>;
  model_catalog: CatalogModel[];
  min_sample: number;
}

export const costsApi = {
  spend: (params: Record<string, string>) => request<SpendData>("/admin/spend", params),
  unitEconomics: (params: Record<string, string>) =>
    request<UnitEconomicsData>("/admin/unit-economics", params),
};
