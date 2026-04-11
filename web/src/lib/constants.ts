/**
 * Free tier limits — must match api/core/entitlements.py.
 * Used for UI messaging only; actual enforcement is server-side.
 */
export const FREE_DAILY_SESSION_LIMIT = 5;
export const FREE_DAILY_SCAN_LIMIT = 3;
export const FREE_DAILY_CHAT_LIMIT = 20;

/**
 * Per-subject UI config — gradients, colors, names, icons.
 * Single source of truth for all subject-specific styling.
 */
export interface SubjectConfig {
  name: string;
  icon: string;
  color: string;
  bg: string;
  gradient: string;
}

export const SUBJECT_CONFIG: Record<string, SubjectConfig> = {
  math: { name: "Mathematics", icon: "📐", color: "text-[#7C3AED]", bg: "bg-[#7C3AED]/10", gradient: "from-[#7C3AED] to-[#A78BFA]" },
  chemistry: { name: "Chemistry", icon: "🧪", color: "text-[#00B894]", bg: "bg-[#00B894]/10", gradient: "from-[#00B894] to-[#55EFC4]" },
  physics: { name: "Physics", icon: "🚀", color: "text-[#0984E3]", bg: "bg-[#0984E3]/10", gradient: "from-[#0984E3] to-[#74B9FF]" },
};

// ── Teacher portal timings + limits ──
// Single source of truth so you don't have to grep for "3000" to find
// the poll interval next time you want to tune it.

/** How often the course page polls an in-flight bank generation job. */
export const BANK_JOB_POLL_INTERVAL_MS = 3000;
/** Hard timeout for a single generation job — abandons the job as failed. */
export const BANK_JOB_POLL_LIMIT_MS = 5 * 60 * 1000;
/** How long a finished bulk-generation toast stays visible before auto-clear. */
export const BANK_JOB_TOAST_AUTO_CLEAR_MS = 4000;
/** Workshop modal undo grace period after an edit lands. */
export const WORKSHOP_UNDO_GRACE_MS = 30_000;
/** Materials tab upload size cap (matches backend). */
export const MATERIAL_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
