import {
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { colors, spacing, radii, shadows } from "../theme";

interface MathKeyboardProps {
  onInsert: (value: string) => void;
}

const KEYS = [
  { label: "+", value: "+" },
  { label: "\u2212", value: "-" },
  { label: "\u00D7", value: "*" },
  { label: "\u00F7", value: "/" },
  { label: "^", value: "^" },
  { label: "(", value: "(" },
  { label: ")", value: ")" },
  { label: "=", value: "=" },
  { label: "\u221A", value: "sqrt(" },
  { label: "x", value: "x" },
];

export function MathKeyboard({ onInsert }: MathKeyboardProps) {
  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {KEYS.map((key) => (
          <AnimatedPressable
            key={key.label}
            style={[styles.key, shadows.sm]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onInsert(key.value);
            }}
            scaleDown={0.9}
            accessibilityLabel={`Insert ${key.label}`}
          >
            <Text style={styles.keyText}>{key.label}</Text>
          </AnimatedPressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    paddingVertical: spacing.md,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "center",
  },
  key: {
    backgroundColor: colors.white,
    borderRadius: radii.md,
    paddingVertical: 14,
    minWidth: 60,
    width: "17%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  keyText: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.text,
  },
});
