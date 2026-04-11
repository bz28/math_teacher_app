import { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useThemePref } from "../stores/themePref";
import { useColors, radii, spacing, typography, type ColorPalette } from "../theme";

/**
 * Single button that cycles system → light → dark → system.
 * Shows both an icon (current state) and the text label so the user
 * can see clearly that the click registered.
 */
export function ThemeToggle() {
  const { pref, resolved, toggle } = useThemePref();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const iconName: keyof typeof Ionicons.glyphMap =
    pref === "system" ? "phone-portrait-outline" : resolved === "dark" ? "sunny-outline" : "moon-outline";

  // Show the resolved theme so the user always knows what they're experiencing.
  // If in auto mode, prefix with "Auto" so they know it's system-driven.
  const label =
    pref === "system"
      ? `Auto (${resolved === "dark" ? "Dark" : "Light"})`
      : pref === "dark" ? "Dark" : "Light";

  return (
    <TouchableOpacity
      onPress={() => {
        toggle();
      }}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={`Theme: ${label}. Tap to change.`}
      activeOpacity={0.6}
    >
      <Ionicons name={iconName} size={18} color={colors.primary} />
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryBg,
    minWidth: 100,
    justifyContent: "center",
  },
  label: {
    ...typography.label,
    color: colors.primary,
    fontSize: 13,
  },
});
