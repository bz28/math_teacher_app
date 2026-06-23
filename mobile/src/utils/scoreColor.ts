import type { ColorPalette } from "../theme";

/**
 * Maps a 0-100 score to a palette color using the same banding as the web
 * gradebook (strong >= 80, average 60-79, struggling < 60). Theme-aware, so
 * it lives here rather than in the pure grades util.
 */
export function scoreColor(score: number, colors: ColorPalette): string {
  if (score >= 80) return colors.success;
  if (score >= 60) return colors.textSecondary;
  return colors.error;
}
