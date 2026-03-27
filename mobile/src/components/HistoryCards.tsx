import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { type SessionHistoryItem } from "../services/api";
import { formatRelativeDate } from "../utils/dateFormatting";
import { colors, spacing, radii, typography, shadows } from "../theme";

export function InProgressCard({ item, onPress }: { item: SessionHistoryItem; onPress: () => void }) {
  return (
    <AnimatedPressable style={[styles.inProgressCard, shadows.sm]} onPress={onPress} scaleDown={0.98}>
      <Ionicons name="play-circle" size={22} color={colors.success} style={styles.historyIcon} />
      <View style={styles.historyContent}>
        <Text style={styles.historyProblem} numberOfLines={1}>{item.problem}</Text>
        <Text style={styles.historyMeta}>
          Step {item.current_step} of {item.total_steps} · {formatRelativeDate(item.created_at)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </AnimatedPressable>
  );
}

export function CompletedCard({ item, onPress }: { item: SessionHistoryItem; onPress: () => void }) {
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
        <Text style={styles.historyProblem} numberOfLines={1}>{item.problem}</Text>
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

export const historyCardStyles = StyleSheet.create({
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

const styles = historyCardStyles;
