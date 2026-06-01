import { Text, type TextStyle } from "react-native";
import { useColors, typography } from "../theme";

interface EyebrowProps {
  children: React.ReactNode;
  style?: TextStyle;
  tone?: "default" | "invert" | "muted";
}

/**
 * Editorial small-caps tracked label, used above section headlines
 * and major page moments. 11px / 600 weight / 0.18em (≈2px) tracking
 * / uppercase. Mirrors the .eyebrow component from web/src/components/
 * landing/eyebrow.tsx so mobile and web speak the same hierarchy.
 *
 * Tones: default (secondary text), invert (cream against primary or
 * dark surfaces), muted (third-tier).
 */
export function Eyebrow({ children, style, tone = "default" }: EyebrowProps) {
  const colors = useColors();
  const color =
    tone === "invert"
      ? colors.textOnPrimary
      : tone === "muted"
      ? colors.textMuted
      : colors.textSecondary;
  return <Text style={[typography.eyebrow, { color }, style]}>{children}</Text>;
}
