import { Platform, ViewStyle } from "react-native";

// ── Colors ──────────────────────────────────────────────
export const colors = {
  // Primary
  primary: "#6C5CE7",
  primaryLight: "#A29BFE",
  primaryBg: "#F0EDFF",
  primaryDark: "#5A4BD1",

  // Success
  success: "#00B894",
  successLight: "#E8F8F5",
  successBorder: "#B2DFDB",

  // Error
  error: "#FF6B6B",
  errorLight: "#FFF0F0",
  errorBorder: "#FFCDD2",

  // Warning / Flag
  warning: "#FDCB6E",
  warningDark: "#E17055",
  warningBg: "#FFF8E1",

  // Text
  text: "#2D3436",
  textSecondary: "#636E72",
  textMuted: "#B2BEC3",
  textOnPrimary: "#FFFFFF",

  // Backgrounds
  background: "#FAFAFE",
  backgroundDark: "#1A1A2E",
  card: "#F8F7FF",
  inputBg: "#F5F4FB",

  // Borders
  border: "#E8E5F0",
  borderLight: "#F0EEF8",

  // Misc
  white: "#FFFFFF",
  overlay: "rgba(108, 92, 231, 0.08)",
  overlayDark: "rgba(26, 26, 46, 0.6)",
  primaryOverlay: "rgba(108, 92, 231, 0.18)",
  primaryOverlayStrong: "rgba(108, 92, 231, 0.85)",
  neutral300: "#D1D3D9",
} as const;

// ── Spacing (4px grid) ──────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// ── Radii ───────────────────────────────────────────────
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 100,
} as const;

// ── Typography ──────────────────────────────────────────
export const typography = {
  hero: { fontSize: 30, fontWeight: "800" as const, letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: "700" as const, letterSpacing: -0.3 },
  heading: { fontSize: 20, fontWeight: "700" as const },
  body: { fontSize: 16, fontWeight: "400" as const, lineHeight: 24 },
  bodyBold: { fontSize: 16, fontWeight: "600" as const },
  label: { fontSize: 13, fontWeight: "600" as const, letterSpacing: 0.3 },
  caption: { fontSize: 12, fontWeight: "500" as const },
  button: { fontSize: 16, fontWeight: "700" as const },
  small: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.5, textTransform: "uppercase" as const },
} as const;

// ── Shadows ─────────────────────────────────────────────
export const shadows: Record<string, ViewStyle> = {
  sm: Platform.select({
    ios: {
      shadowColor: "#6C5CE7",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
    },
    android: { elevation: 2 },
  }) as ViewStyle,
  md: Platform.select({
    ios: {
      shadowColor: "#6C5CE7",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
    },
    android: { elevation: 4 },
  }) as ViewStyle,
  lg: Platform.select({
    ios: {
      shadowColor: "#6C5CE7",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.15,
      shadowRadius: 24,
    },
    android: { elevation: 8 },
  }) as ViewStyle,
};

// ── Gradient presets ────────────────────────────────────
export const gradients = {
  primary: ["#6C5CE7", "#A29BFE"] as const,
  header: ["#6C5CE7", "#8B7CF7"] as const,
  success: ["#00B894", "#55EFC4"] as const,
  warning: ["#E17055", "#FDCB6E"] as const,
  chemistry: ["#00B894", "#55EFC4"] as const,
  physics: ["#0984E3", "#74B9FF"] as const,
  cs: ["#E17055", "#FDCB6E"] as const,
  card: ["#F8F7FF", "#F0EDFF"] as const,
} as const;
