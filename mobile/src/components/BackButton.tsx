import { Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { colors, spacing, typography } from "../theme";

interface BackButtonProps {
  onPress: () => void;
  label?: string;
}

export function BackButton({ onPress, label = "Back" }: BackButtonProps) {
  return (
    <AnimatedPressable
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        minHeight: 44,
      }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Ionicons name="chevron-back" size={20} color={colors.primary} />
      <Text style={{ color: colors.primary, ...typography.bodyBold }}>{label}</Text>
    </AnimatedPressable>
  );
}
