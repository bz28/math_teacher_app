/**
 * The Veradic mark, "Balanced": an equals sign whose top bar is clean (the
 * answer) and whose bottom bar is hand-drawn (the student's own reasoning).
 * The two match, which is what the understanding check confirms.
 *
 * One drawing on a 64-unit grid, used by every surface that draws the mark
 * (site nav and footer, the app's tile mark, the Apple icon, link-preview
 * images). Static copies of the same paths live in web/src/app/icon.svg,
 * demo/public/favicon.svg, dashboard/public/favicon.svg and
 * scripts/regen_app_icons.py (mobile + favicon.ico); change them together.
 */
export const MARK_TOP = "M13 24 H51";
export const MARK_BOTTOM = "M13 41 C19.5 38.8 24.5 42.4 31 40.8 S43.5 38.9 51 40.6";
export const MARK_STROKE = 8.5;
/** The mark's own bounds (strokes included), for a tight crop beside a wordmark. */
export const MARK_VIEWBOX = "8 18 48 30";

export const BRAND = {
  ink: "#16241D",
  green: "#0F6B4C",
  board: "#14644A",
  chalk: "#F6F8F0",
  sun: "#FFCE3A",
} as const;
