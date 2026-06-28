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

// Subject accents mirror the per-subject theme in globals.css
// ([data-subject="…"]): math = the deep-green brand primary (NOT the
// AI-startup purple this drifted to), physics = blue, chemistry = teal-
// green. Keeping the two systems in lockstep so a subject reads the same
// on the launchpad cards as it does inside its themed pages.
export const SUBJECT_CONFIG: Record<string, SubjectConfig> = {
  math: { name: "Mathematics", icon: "📐", color: "text-[#0E5238]", bg: "bg-[#0E5238]/10", gradient: "from-[#0E5238] to-[#2F8F66]" },
  chemistry: { name: "Chemistry", icon: "🧪", color: "text-[#00876A]", bg: "bg-[#00876A]/10", gradient: "from-[#00876A] to-[#2FB39A]" },
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
/** Materials tab upload size caps (match backend MAX_IMAGE_BYTES / MAX_PDF_BYTES). */
export const MATERIAL_UPLOAD_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MATERIAL_UPLOAD_MAX_PDF_BYTES = 25 * 1024 * 1024;
