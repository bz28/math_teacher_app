import { useMemo } from "react";
import { StyleSheet, Text, View, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors, spacing, typography, type ColorPalette } from "../theme";

export type TabKey =
  | "solve"
  | "history"
  | "review"
  | "account"
  | "school-home"
  | "grades"
  | "practice";

interface Tab {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
}

/** Personal-learner tabs (default). */
export const PERSONAL_TABS: Tab[] = [
  { key: "solve", label: "Study", icon: "flash-outline", iconActive: "flash" },
  { key: "history", label: "History", icon: "time-outline", iconActive: "time" },
  { key: "review", label: "Review", icon: "alert-circle-outline", iconActive: "alert-circle" },
  { key: "account", label: "Account", icon: "person-outline", iconActive: "person" },
];

/** School-student tabs: classroom only. The open-ended personal Study tools
 * (Learn/Mock/Practice) are intentionally NOT here — a school student must
 * not be able to ask the AI tutor for a homework answer and submit it on the
 * same app (matches web, which blocks school students from those routes). */
export const SCHOOL_TABS: Tab[] = [
  { key: "school-home", label: "Home", icon: "home-outline", iconActive: "home" },
  { key: "grades", label: "Grades", icon: "ribbon-outline", iconActive: "ribbon" },
  { key: "practice", label: "Practice", icon: "barbell-outline", iconActive: "barbell" },
  { key: "account", label: "Account", icon: "person-outline", iconActive: "person" },
];

interface Props {
  active: TabKey;
  onChange: (key: TabKey) => void;
  tabs?: Tab[];
}

export function BottomTabBar({ active, onChange, tabs = PERSONAL_TABS }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.tab}
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: isActive }}
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

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingTop: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: spacing.xs,
  },
  label: {
    ...typography.eyebrow,
    fontSize: 10,
    color: colors.textMuted,
  },
  labelActive: {
    color: colors.primary,
  },
});
