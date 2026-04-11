import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { type SessionHistoryItem } from "../services/api";
import { formatRelativeDate } from "../utils/dateFormatting";
import { useColors, spacing, radii, typography, shadows, type ColorPalette } from "../theme";

/** Strip LaTeX delimiters and commands for a clean single-line preview.
 *  Full math rendering via WebView is too heavy for a list of cards. */
export function cleanMathPreview(text: string): string {
  return text
    .replace(/\$\$/g, "")         // $$
    .replace(/\$/g, "")           // $
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, "($1)/($2)")
    .replace(/\\sqrt\s*\{([^}]*)\}/g, "√($1)")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\pm/g, "±")
    .replace(/\\pi/g, "π")
    .replace(/\\theta/g, "θ")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\[a-zA-Z]+/g, "")  // strip remaining commands
    .replace(/[{}]/g, "")         // strip braces
    .replace(/\s+/g, " ")         // collapse whitespace
    .trim();
}

export function InProgressCard({ item, onPress }: { item: SessionHistoryItem; onPress: () => void }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <AnimatedPressable style={[styles.inProgressCard, shadows.sm]} onPress={onPress} scaleDown={0.98}>
      <Ionicons name="play-circle" size={22} color={colors.success} style={styles.historyIcon} />
      <View style={styles.historyContent}>
        <Text style={styles.historyProblem} numberOfLines={1}>{cleanMathPreview(item.problem)}</Text>
        <Text style={styles.historyMeta}>
          Step {item.current_step} of {item.total_steps} · {formatRelativeDate(item.created_at)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </AnimatedPressable>
  );
}

export function CompletedCard({ item, onPress }: { item: SessionHistoryItem; onPress: () => void }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isAbandoned = item.status === "abandoned";
  return (
    <AnimatedPressable style={[styles.completedCard, shadows.sm]} onPress={onPress} scaleDown={0.98}>
      <Ionicons
        name={isAbandoned ? "close-circle" : "checkmark-circle"}
        size={20}
        color={isAbandoned ? colors.error : colors.success}
        style={styles.historyIcon}
      />
      <View style={styles.historyContent}>
        <Text style={styles.historyProblem} numberOfLines={1}>{cleanMathPreview(item.problem)}</Text>
        <Text style={styles.historyMeta}>
          {isAbandoned
            ? `Ended early · Step ${item.current_step} of ${item.total_steps} · ${formatRelativeDate(item.created_at)}`
            : `${item.total_steps} step${item.total_steps !== 1 ? "s" : ""} · ${formatRelativeDate(item.created_at)}`
          }
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </AnimatedPressable>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  inProgressCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
    padding: spacing.lg,
    gap: spacing.md,
  },
  completedCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.lg,
    gap: spacing.md,
  },
  historyIcon: {
    marginTop: 1,
  },
  historyContent: {
    flex: 1,
  },
  historyProblem: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 14,
    marginBottom: spacing.xs,
  },
  historyMeta: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },
});
