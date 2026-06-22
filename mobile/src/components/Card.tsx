import { View, type ViewStyle } from "react-native";
import { useColors, radii, spacing } from "../theme";

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  tone?: "paper" | "alt";
}

/**
 * Editorial card primitive. Flat warm-paper surface with a single 1px
 * alpha-ink hairline border — no drop shadow. Replaces the soft elevated
 * cards from the prior aesthetic; subsequent phases swap shadowed
 * containers for <Card> as they're touched.
 *
 * `tone="alt"` uses the deeper cream (surfaceAlt2) for visual rhythm
 * when stacking multiple cards in a section.
 */
export function Card({ children, style, tone = "paper" }: CardProps) {
  const colors = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: tone === "alt" ? colors.surfaceAlt2 : colors.card,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
