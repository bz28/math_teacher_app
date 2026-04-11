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
