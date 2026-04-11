/**
 * Free tier limits — must match api/core/entitlements.py.
 * Used for UI messaging only; actual enforcement is server-side.
 */
export const FREE_DAILY_SESSION_LIMIT = 5;
export const FREE_DAILY_SCAN_LIMIT = 3;
export const FREE_DAILY_CHAT_LIMIT = 20;

/**
 * Per-subject UI config — names, icons, and a gradient utility class.
 *
 * Colors aren't hard-coded here: the globals.css [data-subject="..."]
 * blocks swap --color-primary + --gradient-primary at runtime, so any
 * component using `bg-primary`, `text-primary`, `bg-gradient-primary`,
 * etc. follows the active subject automatically.
 *
 * The `gradient` field is a subject-specific gradient utility class
 * (defined in globals.css) for cases where a component needs to show
 * a specific subject's gradient regardless of which subject is active
 * (e.g. the subject pill in the header).
 */
export interface SubjectConfig {
  name: string;
  icon: string;
  /** Gradient utility class — subject-specific (not theme-swapping). */
  gradient: string;
}

export const SUBJECT_CONFIG: Record<string, SubjectConfig> = {
  math:      { name: "Mathematics", icon: "📐", gradient: "bg-gradient-math" },
  physics:   { name: "Physics",     icon: "🚀", gradient: "bg-gradient-physics" },
  chemistry: { name: "Chemistry",   icon: "🧪", gradient: "bg-gradient-chemistry" },
};
