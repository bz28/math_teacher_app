import { useState } from "react";
import {
  InputAccessoryView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { colors, spacing, radii } from "../theme";

interface MathKeyboardProps {
  onInsert: (value: string) => void;
  /** nativeID to link with a TextInput's inputAccessoryViewID (iOS only) */
  accessoryID?: string;
}

const CATEGORIES = [
  {
    id: "basic",
    label: "Basic",
    keys: [
      { label: "+", value: "+" },
      { label: "\u2212", value: "-" },
      { label: "\u00D7", value: "*" },
      { label: "\u00F7", value: "/" },
      { label: "=", value: "=" },
      { label: "^", value: "^" },
      { label: "(", value: "(" },
      { label: ")", value: ")" },
    ],
  },
  {
    id: "algebra",
    label: "Algebra",
    keys: [
      { label: "\u221A", value: "sqrt(" },
      { label: "\u03C0", value: "pi" },
      { label: "\u00B1", value: "+-" },
      { label: "\u2264", value: "<=" },
      { label: "\u2265", value: ">=" },
      { label: "\u2260", value: "!=" },
      { label: "|", value: "|" },
    ],
  },
  {
    id: "calculus",
    label: "Calculus",
    keys: [
      { label: "\u222B", value: "integral(" },
      { label: "d/dx", value: "d/dx(" },
      { label: "\u221E", value: "inf" },
      { label: "lim", value: "lim(" },
      { label: "log", value: "log(" },
      { label: "ln", value: "ln(" },
      { label: "sin", value: "sin(" },
      { label: "cos", value: "cos(" },
    ],
  },
];

function Toolbar({ onInsert }: { onInsert: (value: string) => void }) {
  const [activeTab, setActiveTab] = useState("basic");
  const activeCategory = CATEGORIES.find((c) => c.id === activeTab) ?? CATEGORIES[0];

  return (
    <View style={styles.container}>
      {/* Row 1: Category tabs */}
      <View style={styles.tabRow}>
        {CATEGORIES.map((cat) => (
          <Pressable
            key={cat.id}
            style={[styles.tab, activeTab === cat.id && styles.tabActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab(cat.id);
            }}
            hitSlop={4}
            accessibilityLabel={`${cat.label} symbols`}
            accessibilityRole="tab"
          >
            <Text style={[styles.tabText, activeTab === cat.id && styles.tabTextActive]}>
              {cat.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Row 2: Symbol keys */}
      <View style={styles.keyRow}>
        {activeCategory.keys.map((key) => (
          <Pressable
            key={key.label}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onInsert(key.value);
            }}
            accessibilityLabel={`Insert ${key.label}`}
            accessibilityRole="button"
          >
            <Text style={styles.keyText}>{key.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function MathKeyboard({ onInsert, accessoryID }: MathKeyboardProps) {
  if (Platform.OS === "ios" && accessoryID) {
    return (
      <InputAccessoryView nativeID={accessoryID}>
        <Toolbar onInsert={onInsert} />
      </InputAccessoryView>
    );
  }

  return <Toolbar onInsert={onInsert} />;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#D1D3D9",
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    gap: 6,
    marginBottom: spacing.sm,
  },
  tab: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    backgroundColor: "transparent",
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.white,
  },
  keyRow: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    paddingHorizontal: spacing.xs,
  },
  key: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  keyPressed: {
    backgroundColor: "rgba(0,0,0,0.08)",
    borderRadius: radii.sm,
  },
  keyText: {
    fontSize: 18,
    fontWeight: "500",
    color: colors.text,
  },
});
