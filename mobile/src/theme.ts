import { Platform, ViewStyle } from "react-native";
import { useThemePref } from "./stores/themePref";

// ── Colors ──────────────────────────────────────────────
//
// Warm-paper editorial palette, ported from the web tokens in
// web/src/app/globals.css. Two palettes (light + dark) with the same
// shape; useColors() returns the active one. The legacy `colors`
// const still points at light so screens that haven't been refactored
// to useColors() yet stay visually consistent.
//
// Borders are alpha-ink (rgba over the warm paper), not opaque grey —
// this keeps the hairline from showing a grey halo on cream surfaces.

export interface ColorPalette {
  // Primary — academic green, shared with web
  primary: string;
  primaryLight: string;
  primaryBg: string;
  primaryDark: string;

  // Status (warm palette — muted sage / clay / ochre / slate-blue)
  success: string;
  successLight: string;
  successBorder: string;
  error: string;
  errorLight: string;
  errorBorder: string;
  warning: string;
  warningDark: string;
  warningBg: string;
  info: string;
  infoLight: string;
  infoBorder: string;

  // Text (warm neutrals)
  text: string;
  textSecondary: string;
  textMuted: string;
  textOnPrimary: string;

  // Surfaces (warm paper)
  background: string;
  backgroundDark: string;
  card: string;
  inputBg: string;
  surfaceAlt: string;
  surfaceAlt2: string;

  // Borders (alpha-ink, never opaque grey)
  border: string;
  borderLight: string;
  borderStrong: string;

  // Misc / overlays
  // `white` is overloaded as a "neutral surface" that adapts to mode
  // (light → #FFFFFF, dark → warm dark card). For text or icons that
  // need to be true white on a colored CTA, use `textOnPrimary` —
  // that one is #FFFFFF in both palettes.
  white: string;
  overlay: string;
  overlayDark: string;
  primaryOverlay: string;
  primaryOverlayStrong: string;
  neutral300: string;
}

export const lightColors: ColorPalette = {
  primary: "#0E5238",
  primaryLight: "#2F8F66",
  primaryBg: "#E6F0EA",
  primaryDark: "#0A3D2A",

  success: "#4A6B3A",
  successLight: "#E8EAD9",
  successBorder: "#C4CCA8",

  error: "#8A2317",
  errorLight: "#F0D7D1",
  errorBorder: "#D9B5AE",

  warning: "#A66B15",
  warningDark: "#8C5610",
  warningBg: "#F5E8C7",

  info: "#3D5A78",
  infoLight: "#DDE6EF",
  infoBorder: "#B5C2D1",

  text: "#14130F",
  textSecondary: "#5C554C",
  textMuted: "#7D7669",
  textOnPrimary: "#FFFFFF",

  background: "#F7F5F0",
  backgroundDark: "#14130F",
  card: "#FCFAF4",
  inputBg: "#FCFAF4",
  surfaceAlt: "#F7F5F0",
  surfaceAlt2: "#EFECE4",

  border: "rgba(20, 19, 15, 0.18)",
  borderLight: "rgba(20, 19, 15, 0.10)",
  borderStrong: "rgba(20, 19, 15, 0.28)",

  white: "#FFFFFF",
  overlay: "rgba(14, 82, 56, 0.08)",
  overlayDark: "rgba(20, 19, 15, 0.40)",
  primaryOverlay: "rgba(14, 82, 56, 0.18)",
  primaryOverlayStrong: "rgba(14, 82, 56, 0.85)",
  neutral300: "rgba(20, 19, 15, 0.18)",
};

export const darkColors: ColorPalette = {
  primary: "#3FA67A",
  primaryLight: "#5BC298",
  primaryBg: "#1A3329",
  primaryDark: "#5BC298",

  success: "#7A9460",
  successLight: "#243023",
  successBorder: "#3D4A2C",

  error: "#D17A6E",
  errorLight: "#3A2421",
  errorBorder: "#6B3A35",

  warning: "#D4A050",
  warningDark: "#E0B070",
  warningBg: "#3A2F1A",

  info: "#6E89A8",
  infoLight: "#22303F",
  infoBorder: "#3D4D63",

  text: "#F5F1E8",
  textSecondary: "#B8AFA0",
  textMuted: "#807868",
  textOnPrimary: "#FFFFFF",

  background: "#14130F",
  backgroundDark: "#0A0A07",
  card: "#1F1D18",
  inputBg: "#1F1D18",
  surfaceAlt: "#1A1813",
  surfaceAlt2: "#24221C",

  border: "rgba(245, 241, 232, 0.16)",
  borderLight: "rgba(245, 241, 232, 0.08)",
  borderStrong: "rgba(245, 241, 232, 0.28)",

  white: "#1F1D18",
  overlay: "rgba(63, 166, 122, 0.12)",
  overlayDark: "rgba(0, 0, 0, 0.7)",
  primaryOverlay: "rgba(63, 166, 122, 0.22)",
  primaryOverlayStrong: "rgba(63, 166, 122, 0.85)",
  neutral300: "rgba(245, 241, 232, 0.16)",
};

/** Legacy export — points at the LIGHT palette. Existing screens
 * that import `colors` from "../theme" continue to work; they just
 * won't react to dark mode until refactored to useColors(). */
export const colors = lightColors;

/** Hook returning the active color palette based on theme preference. */
export function useColors(): ColorPalette {
  const { resolved } = useThemePref();
  return resolved === "dark" ? darkColors : lightColors;
}

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
//
// Two voices: system sans for body type, Instrument Serif for
// editorial display headlines and italic emphasis phrases. Mirrors
// the web pairing (Inter + Instrument Serif). Eyebrow is the small-
// caps tracked label used above section headings.

export const fontFamilies = {
  serif: "InstrumentSerif_400Regular",
  serifItalic: "InstrumentSerif_400Regular_Italic",
} as const;

export const typography = {
  // ── Serif display ──
  displaySerif: {
    fontFamily: fontFamilies.serif,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -0.5,
  },
  // Despite the name, this points at the NON-italic Instrument Serif —
  // the italic variant read "almost cursive" in app and we want the
  // straight editorial display face instead. Token name kept for now to
  // avoid touching every call site; a rename pass can come later.
  displaySerifItalic: {
    fontFamily: fontFamilies.serif,
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: -0.4,
  },
  serifSubhead: {
    fontFamily: fontFamilies.serifItalic,
    fontSize: 22,
    lineHeight: 28,
  },

  // ── Sans (system) ──
  hero: { fontSize: 30, fontWeight: "800" as const, letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: "700" as const, letterSpacing: -0.3 },
  heading: { fontSize: 20, fontWeight: "700" as const },
  body: { fontSize: 16, fontWeight: "400" as const, lineHeight: 24 },
  bodyBold: { fontSize: 16, fontWeight: "600" as const },
  label: { fontSize: 13, fontWeight: "600" as const, letterSpacing: 0.3 },
  caption: { fontSize: 12, fontWeight: "500" as const },
  button: { fontSize: 16, fontWeight: "700" as const },
  small: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
  },

  // Eyebrow — small-caps tracked label, editorial signature. Matches
  // web's .eyebrow (11px / 600 / 0.18em / uppercase). New token; use
  // this instead of `small` for section eyebrows going forward.
  eyebrow: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 2,
    textTransform: "uppercase" as const,
  },
} as const;

// ── Shadows ─────────────────────────────────────────────
//
// Hairline-first: editorial surfaces lean on 1px alpha borders for
// separation, not drop shadows. Shadow tokens stay exported so the
// existing screens compile, but the values are dialed down to near-
// invisible. For new card chrome, prefer `borderWidth: 1, borderColor:
// colors.border` over `shadows.sm`.

export const shadows: Record<string, ViewStyle> = {
  sm: Platform.select({
    ios: {
      shadowColor: "#14130F",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 3,
    },
    android: { elevation: 1 },
  }) as ViewStyle,
  md: Platform.select({
    ios: {
      shadowColor: "#14130F",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 6,
    },
    android: { elevation: 2 },
  }) as ViewStyle,
  lg: Platform.select({
    ios: {
      shadowColor: "#14130F",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.10,
      shadowRadius: 14,
    },
    android: { elevation: 4 },
  }) as ViewStyle,
};

// ── Gradient presets ────────────────────────────────────
//
// Editorial reset: most gradients retire in favor of flat warm paper.
// Two families remain — `primary` for the signature CTA gradient
// (used sparingly), and subject gradients (math/chemistry/physics)
// for the home-screen subject pills. Other keys stay exported as
// near-flat variants so existing call sites compile while we migrate
// them away in later phases.

// ── Gradients ──────────────────────────────────────────
//
// Two palettes, like colors. `gradients` is the legacy light-mode
// export still used by screens that import the static `colors` const
// and never theme-switch. Components that read `useColors()` should
// also use `useGradients()` so the brand surface adapts to dark mode
// (otherwise primary CTAs render with the bright light-mode greens
// against warm dark paper, which looks punched out).

const lightFlatPrimary = ["#0E5238", "#0E5238"] as const;
const lightFlatCard = ["#FCFAF4", "#FCFAF4"] as const;

export const gradients = {
  primary: ["#0E5238", "#2F8F66"] as const,
  header: lightFlatPrimary,
  // Distinct teal so onboarding's Unlimited Practice card doesn't read
  // identical to the green Learn card stacked above it.
  success: ["#00876A", "#2FA68C"] as const,
  warning: ["#A66B15", "#8C5610"] as const,
  math: ["#0E5238", "#2F8F66"] as const,
  chemistry: ["#00876A", "#2FA68C"] as const,
  physics: ["#3D5A78", "#5C7A98"] as const,
  card: lightFlatCard,
} as const;

const darkFlatPrimary = ["#3FA67A", "#3FA67A"] as const;
const darkFlatCard = ["#1F1D18", "#1F1D18"] as const;

export const darkGradients = {
  primary: ["#3FA67A", "#5BC298"] as const,
  header: darkFlatPrimary,
  success: ["#3FA68A", "#5BC2A8"] as const,
  warning: ["#D4A050", "#E0B070"] as const,
  math: ["#3FA67A", "#5BC298"] as const,
  chemistry: ["#3FA68A", "#5BC2A8"] as const,
  physics: ["#6E89A8", "#8AA3BE"] as const,
  card: darkFlatCard,
} as const;

/**
 * Hook returning the active gradient set based on theme preference.
 * Returns a structural type with the same keys as `gradients` so dark
 * variants can supply their own literal hex tuples without TS narrowing
 * conflicts.
 */
export type GradientPalette = {
  readonly [K in keyof typeof gradients]: readonly [string, string];
};

export function useGradients(): GradientPalette {
  const { resolved } = useThemePref();
  return resolved === "dark" ? darkGradients : gradients;
}
