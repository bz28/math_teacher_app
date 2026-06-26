import type { ColorPalette } from "../theme";

/**
 * Maps a 0-100 score to a palette color using the same banding as the web
 * gradebook (web/src/components/school/shared/percent-badge.tsx):
 * strong >= 85, average 70-84, struggling < 70. Theme-aware, so it lives
 * here rather than in the pure grades util.
 */
export function scoreColor(score: number, colors: ColorPalette): string {
  if (score >= 85) return colors.success;
  if (score >= 70) return colors.textSecondary;
  return colors.error;
}
