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

export const costsApi = {
  spend: (params: Record<string, string>) => request<SpendData>("/admin/spend", params),
};
