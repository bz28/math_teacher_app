/**
 * Operator definitions — the SINGLE source of truth for the terms the
 * console runs on. Every tab imports from here instead of re-deriving
 * "active", "at-risk", or the cost window. Change a threshold here and
 * it moves everywhere at once.
 *
 * ── Terms in plain English ─────────────────────────────────────────
 * - Active   — did SOMETHING within the last 7 days.
 * - Stale    — went quiet 8–29 days ago (cooling off; worth a nudge).
 * - Dormant  — silent 30+ days, or never seen (effectively gone).
 * - At-risk  — was engaged and has since gone quiet (14+ days), OR is
 *              throwing failed AI calls right now. This is the "needs
 *              you" signal, distinct from a customer who simply hasn't
 *              started yet.
 * - Healthy  — active and not failing.
 * - Cost window — cost is ALWAYS shown with the window it covers
 *   (e.g. "30d"), never a silent lifetime total. Use windowLabel().
 *
 * ── What feeds "last active" ───────────────────────────────────────
 * There is no unified cross-source "last active" in the admin API
 * today. Each endpoint exposes the best recency field it has, and we
 * normalize whatever it returns:
 *   - Schools (/admin/schools):  last_activity_at = max(submission.submitted_at)
 *   - Users   (/admin/users):    last_active      = max(session.created_at)
 * Both miss teacher-only actions logged solely in ActivityLog
 * (grade/publish with no session or submission). When a unified
 * "last_active_at" that folds in ActivityLog.performed_at lands on the
 * backend, pass it here unchanged — the thresholds below don't move.
 */

export const ACTIVE_WITHIN_DAYS = 7;
export const STALE_AFTER_DAYS = 14;
export const DORMANT_AFTER_DAYS = 30;

/** Default cost window shown across the console when a tab has no
 *  operator-selected window of its own. Always render alongside the
 *  number via costWindowLabel / windowLabel. */
export const COST_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ActivityStatus = "active" | "stale" | "dormant";

/** Days elapsed since an ISO timestamp, or null if absent/unparseable. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / DAY_MS;
}

/**
 * Classify an entity by how recently it last did anything.
 * A null/absent timestamp (never active) counts as dormant.
 */
export function activityStatus(lastActiveAt: string | null | undefined): ActivityStatus {
  const d = daysSince(lastActiveAt);
  if (d === null) return "dormant";
  if (d <= ACTIVE_WITHIN_DAYS) return "active";
  if (d < DORMANT_AFTER_DAYS) return "stale";
  return "dormant";
}

export interface RiskInput {
  /** Best available "last active" timestamp for the entity (see module doc). */
  lastActiveAt: string | null | undefined;
  /** Failing AI calls attributed to the entity in the current window. */
  failedCalls?: number;
}

/**
 * At-risk = an entity that WAS engaged and is slipping: failing AI
 * calls now, or gone quiet past the stale threshold. A never-seen
 * entity (null timestamp, no failures) is NOT at-risk — it simply
 * hasn't started, which is a different concern from a lapsing customer.
 */
export function isAtRisk({ lastActiveAt, failedCalls = 0 }: RiskInput): boolean {
  if (failedCalls > 0) return true;
  const d = daysSince(lastActiveAt);
  if (d === null) return false;
  return d > STALE_AFTER_DAYS;
}

/** Healthy = active and not throwing failed AI calls. */
export function isHealthy({ lastActiveAt, failedCalls = 0 }: RiskInput): boolean {
  return failedCalls === 0 && activityStatus(lastActiveAt) === "active";
}

/**
 * Human window label for a cost/metric figure, from an hours value.
 * Cost must never be shown without one of these next to it.
 *   1 → "1h", 6 → "6h", 24 → "24h", 168 → "7d", 720 → "30d", huge → "all-time"
 */
export function windowLabel(hours: number): string {
  if (hours <= 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days >= 365) return "all-time";
  return `${days}d`;
}

/** Compact day-window label, e.g. costWindowLabel(30) → "30d". */
export function costWindowLabel(days: number = COST_WINDOW_DAYS): string {
  return `${days}d`;
}

/**
 * Canonical StatusPill tone + label for an activity status. Keeps the
 * active/stale/dormant vocabulary identical on every tab that renders
 * recency — spread the result straight into <StatusPill {...} />.
 * (Tone strings match StatusPill's PillTone union.)
 */
export function activityPill(status: ActivityStatus): {
  tone: "ok" | "warn" | "neutral";
  label: string;
} {
  switch (status) {
    case "active":
      return { tone: "ok", label: "ACTIVE" };
    case "stale":
      return { tone: "warn", label: "STALE" };
    case "dormant":
      return { tone: "neutral", label: "DORMANT" };
  }
}
