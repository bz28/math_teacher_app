import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { useColors, spacing, radii, typography, gradients, type ColorPalette } from "../theme";

export type SubjectKey = "math" | "physics" | "chemistry";

export interface SubjectMeta {
  key: SubjectKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  gradient: keyof typeof gradients;
  primary: string;
  primaryBg: string;
}

export const SUBJECTS: SubjectMeta[] = [
  { key: "math",      label: "Math",      icon: "calculator", gradient: "math",      primary: "#F39C12", primaryBg: "#FEF5E7" },
  { key: "physics",   label: "Physics",   icon: "rocket",     gradient: "physics",   primary: "#0984E3", primaryBg: "#E3F2FD" },
  { key: "chemistry", label: "Chemistry", icon: "flask",      gradient: "chemistry", primary: "#00B894", primaryBg: "#E8F8F5" },
];

export function getSubjectMeta(key: string): SubjectMeta {
  return SUBJECTS.find((s) => s.key === key) ?? SUBJECTS[0];
}

interface Props {
  active: string;
  onChange: (key: string) => void;
}

export function SubjectPills({ active, onChange }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.outer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {SUBJECTS.map((s) => {
          const isActive = s.key === active;
          return (
            <AnimatedPressable
              key={s.key}
              onPress={() => onChange(s.key)}
              scaleDown={0.95}
              accessibilityRole="button"
              accessibilityLabel={`${s.label}${isActive ? ", selected" : ""}`}
              accessibilityState={{ selected: isActive }}
            >
              {isActive ? (
                <LinearGradient
                  colors={gradients[s.gradient]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.pill}
                >
                  <Ionicons name={s.icon} size={16} color={colors.white} />
                  <Text style={styles.pillText}>{s.label}</Text>
                </LinearGradient>
              ) : (
                <View style={[styles.pill, styles.pillInactive]}>
                  <Ionicons name={s.icon} size={16} color={colors.textSecondary} />
                  <Text style={[styles.pillText, styles.pillTextInactive]}>{s.label}</Text>
                </View>
              )}
            </AnimatedPressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  outer: {
    backgroundColor: colors.background,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.pill,
  },
  pillInactive: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillText: {
    ...typography.label,
    color: colors.white,
    fontSize: 13,
  },
  pillTextInactive: {
    color: colors.textSecondary,
  },
});
