import { StyleSheet, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useThemePref } from "../stores/themePref";
import { colors, radii } from "../theme";

/**
 * Mobile equivalent of web/src/components/ui/theme-toggle.tsx —
 * a single icon button that cycles system → light → dark → system.
 *
 * Icon represents current state:
 * - system  → monitor (auto)
 * - light   → moon (resolved currently light)
 * - dark    → sun (resolved currently dark)
 */
export function ThemeToggle() {
  const { pref, resolved, toggle } = useThemePref();

  const iconName: keyof typeof Ionicons.glyphMap =
    pref === "system" ? "phone-portrait-outline" : resolved === "dark" ? "sunny-outline" : "moon-outline";

  const label =
    pref === "system"
      ? "Using system theme"
      : pref === "dark"
        ? "Switch to system theme"
        : "Switch to dark mode";

  return (
    <TouchableOpacity
      onPress={() => { toggle(); }}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <View>
        <Ionicons name={iconName} size={18} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    justifyContent: "center",
    alignItems: "center",
  },
});
