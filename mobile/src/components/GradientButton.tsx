import { useMemo } from "react";
import { ActivityIndicator, Text, StyleSheet, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AnimatedPressable } from "./AnimatedPressable";
import { useColors, radii, spacing, typography, gradients, type ColorPalette } from "../theme";

type GradientPreset = keyof typeof gradients;

interface GradientButtonProps {
  onPress: () => void;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  gradient?: GradientPreset;
  style?: ViewStyle;
}

export function GradientButton({
  onPress,
  label,
  loading = false,
  disabled = false,
  gradient = "primary",
  style,
}: GradientButtonProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <AnimatedPressable
      style={[(loading || disabled) && styles.disabled]}
      onPress={onPress}
      disabled={loading || disabled}
    >
      <LinearGradient
        colors={gradients[gradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.button, style]}
      >
        {loading ? (
          <ActivityIndicator color={colors.white} size="small" />
        ) : (
          <Text style={styles.text}>{label}</Text>
        )}
      </LinearGradient>
    </AnimatedPressable>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  button: {
    borderRadius: radii.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxl,
    alignItems: "center",
  },
  text: {
    color: colors.white,
    ...typography.button,
  },
  disabled: {
    opacity: 0.4,
  },
});
