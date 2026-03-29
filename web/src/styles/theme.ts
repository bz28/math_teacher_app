/**
 * Design system tokens — mirrors mobile/src/theme.ts exactly.
 * CSS variables are defined in globals.css; this file provides
 * TypeScript access for JS-driven styles (e.g., Framer Motion).
 */

export const colors = {
  primary: "#6C5CE7",
  primaryLight: "#A29BFE",
  primaryBg: "#F0EDFF",
  primaryDark: "#5A4BD1",

  success: "#00B894",
  successLight: "#E8F8F5",
  successBorder: "#B2DFDB",

  error: "#FF6B6B",
  errorLight: "#FFF0F0",
  errorBorder: "#FFCDD2",

  warning: "#FDCB6E",
  warningDark: "#E17055",
  warningBg: "#FFF8E1",

  text: "#2D3436",
  textSecondary: "#636E72",
  textMuted: "#B2BEC3",
  textOnPrimary: "#FFFFFF",

  background: "#FAFAFE",
  card: "#F8F7FF",
  inputBg: "#F5F4FB",

  border: "#E8E5F0",
  borderLight: "#F0EEF8",

  white: "#FFFFFF",
  overlay: "rgba(108, 92, 231, 0.08)",
} as const;

export const gradients = {
  primary: [colors.primary, colors.primaryLight],
  header: [colors.primary, "#8B7CF7"],
  success: [colors.success, "#55EFC4"],
  warning: [colors.warningDark, colors.warning],
  chemistry: [colors.success, "#55EFC4"],
  card: [colors.card, colors.primaryBg],
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 100,
} as const;

export const typography = {
  hero: { fontSize: 30, fontWeight: 800, letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: 700, letterSpacing: -0.3 },
  heading: { fontSize: 20, fontWeight: 700 },
  body: { fontSize: 16, fontWeight: 400, lineHeight: 24 },
  bodyBold: { fontSize: 16, fontWeight: 600 },
  label: { fontSize: 13, fontWeight: 600, letterSpacing: 0.3 },
  caption: { fontSize: 12, fontWeight: 500 },
  button: { fontSize: 16, fontWeight: 700 },
  small: { fontSize: 11, fontWeight: 600, letterSpacing: 0.5 },
} as const;
