import { useMemo } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AnimatedPressable } from "./AnimatedPressable";
import {
  useColors,
  useGradients,
  radii,
  spacing,
  typography,
  type ColorPalette,
} from "../theme";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps {
  onPress: () => void;
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

/**
 * Editorial button primitive. Three variants:
 *   - primary: signature green gradient fill, white text (the "decisive
 *     accent" used sparingly per the editorial system).
 *   - secondary: hairline alpha-ink border on warm paper, primary-color
 *     label. Used for paired actions where neither dominates.
 *   - ghost: no chrome, primary-color label only. Inline/text-button feel.
 *
 * Sister to GradientButton — that one stays around for legacy call sites
 * with the old single-style gradient API; new screens use this.
 */
export function Button({
  onPress,
  label,
  variant = "primary",
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const colors = useColors();
  const gradients = useGradients();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isDisabled = loading || disabled;

  const labelNode = loading ? (
    <ActivityIndicator
      color={variant === "primary" ? colors.textOnPrimary : colors.primary}
      size="small"
    />
  ) : (
    <Text style={styles[`${variant}Text`]}>{label}</Text>
  );

  if (variant === "primary") {
    return (
      <AnimatedPressable
        style={[isDisabled && styles.disabled, style]}
        onPress={onPress}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.button}
        >
          {labelNode}
        </LinearGradient>
      </AnimatedPressable>
    );
  }

  return (
    <AnimatedPressable
      style={[styles.button, styles[variant], isDisabled && styles.disabled, style]}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {labelNode}
    </AnimatedPressable>
  );
}

const makeStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    button: {
      borderRadius: radii.md,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.xxl,
      alignItems: "center",
      justifyContent: "center",
    },
    secondary: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.border,
    },
    ghost: {
      backgroundColor: "transparent",
    },
    primaryText: { color: colors.textOnPrimary, ...typography.button },
    secondaryText: { color: colors.primary, ...typography.button },
    ghostText: { color: colors.primary, ...typography.button },
    disabled: { opacity: 0.4 },
  });
