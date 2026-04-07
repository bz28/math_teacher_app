import { StyleSheet, Text, View, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "../theme";

export type TabKey = "solve" | "history" | "library" | "account";

interface Tab {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
}

const TABS: Tab[] = [
  { key: "solve", label: "Solve", icon: "flash-outline", iconActive: "flash" },
  { key: "history", label: "History", icon: "time-outline", iconActive: "time" },
  { key: "library", label: "Library", icon: "library-outline", iconActive: "library" },
  { key: "account", label: "Account", icon: "person-outline", iconActive: "person" },
];

interface Props {
  active: TabKey;
  onChange: (key: TabKey) => void;
}

export function BottomTabBar({ active, onChange }: Props) {
  return (
    <View style={styles.bar}>
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.tab}
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: isActive }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons
              name={isActive ? t.iconActive : t.icon}
              size={22}
              color={isActive ? colors.primary : colors.textMuted}
            />
            <Text style={[styles.label, isActive && styles.labelActive]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.white,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: spacing.xs,
  },
  label: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
  },
  labelActive: {
    color: colors.primary,
  },
});
