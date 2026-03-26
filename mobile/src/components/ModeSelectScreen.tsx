import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { getSessionHistory, type SessionHistoryItem } from "../services/api";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

export type Mode = "learn" | "practice" | "mock_test";

interface ModeSelectScreenProps {
  subject: string;
  onSelect: (mode: Mode) => void;
  onBack: () => void;
  onViewSession: (sessionId: string) => void;
  onViewAllHistory: () => void;
}

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

interface ModeConfig {
  id: Mode;
  label: string;
  icon: IoniconsName;
  gradient: readonly [string, string];
  description: string;
  features: string[];
}

const MODES: ModeConfig[] = [
  {
    id: "learn",
    label: "Learn",
    icon: "book",
    gradient: gradients.primary,
    description: "Step-by-step guided learning",
    features: ["AI breaks problems into steps", "Ask questions anytime", "Practice similar problems after"],
  },
  {
    id: "mock_test",
    label: "Mock Test",
    icon: "document-text",
    gradient: gradients.warning,
    description: "Use your own problems or generate an exam",
    features: ["Timed or untimed exams", "Generate similar questions", "Review and learn flagged problems"],
  },
];

const HISTORY_PREVIEW_LIMIT = 5;

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function HistoryCard({ item, onPress }: { item: SessionHistoryItem; onPress: () => void }) {
  const isCompleted = item.status === "completed";
  return (
    <AnimatedPressable style={[styles.historyCard, shadows.sm]} onPress={onPress} scaleDown={0.98}>
      <Ionicons
        name={isCompleted ? "checkmark-circle" : "time-outline"}
        size={20}
        color={isCompleted ? colors.success : colors.textMuted}
        style={styles.historyIcon}
      />
      <View style={styles.historyContent}>
        <Text style={styles.historyProblem} numberOfLines={1}>{item.problem}</Text>
        <Text style={styles.historyMeta}>
          {item.total_steps} step{item.total_steps !== 1 ? "s" : ""} · {formatRelativeDate(item.created_at)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </AnimatedPressable>
  );
}

export function ModeSelectScreen({ subject, onSelect, onBack, onViewSession, onViewAllHistory }: ModeSelectScreenProps) {
  const [history, setHistory] = useState<SessionHistoryItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await getSessionHistory(subject, HISTORY_PREVIEW_LIMIT);
      setHistory(res.items);
      setHasMore(res.has_more);
    } catch {
      // Silently fail — history is non-critical
    } finally {
      setLoading(false);
    }
  }, [subject]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <SafeAreaView style={styles.container}>
      <AnimatedPressable style={styles.backButton} onPress={onBack}>
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </AnimatedPressable>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>How do you want{"\n"}to study?</Text>
        </View>

        <View style={styles.list}>
          {MODES.map((mode) => (
            <AnimatedPressable
              key={mode.id}
              style={[styles.card, shadows.md]}
              onPress={() => onSelect(mode.id)}
              scaleDown={0.97}
            >
              <LinearGradient
                colors={mode.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cardGradientHeader}
              >
                <Ionicons name={mode.icon} size={24} color={colors.white} />
                <Text style={styles.cardLabel}>{mode.label}</Text>
                <Ionicons name="arrow-forward-circle" size={22} color="rgba(255,255,255,0.7)" style={styles.cardArrow} />
              </LinearGradient>
              <View style={styles.cardBody}>
                <Text style={styles.cardDesc}>{mode.description}</Text>
                {mode.features.map((feature, i) => (
                  <View key={i} style={styles.featureRow}>
                    <Ionicons name="checkmark" size={14} color={colors.success} />
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </View>
            </AnimatedPressable>
          ))}
        </View>

        {/* History section */}
        <View style={styles.historySection}>
          <View style={styles.historyHeader}>
            <Text style={styles.sectionLabel}>YOUR HISTORY</Text>
            {hasMore && (
              <AnimatedPressable onPress={onViewAllHistory}>
                <Text style={styles.seeAllText}>See All</Text>
              </AnimatedPressable>
            )}
          </View>

          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.historyLoading} />
          ) : history.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="book-outline" size={28} color={colors.textMuted} />
              <Text style={styles.emptyText}>No sessions yet — start learning{"\n"}and your progress will show up here!</Text>
            </View>
          ) : (
            <View style={styles.historyList}>
              {history.map((item) => (
                <HistoryCard
                  key={item.id}
                  item={item}
                  onPress={() => onViewSession(item.id)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xxl + 4,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },
  backButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    marginBottom: spacing.sm,
  },
  backText: { color: colors.primary, ...typography.bodyBold },

  header: {
    marginBottom: spacing.xxl,
  },
  title: {
    ...typography.hero,
    color: colors.text,
  },

  list: {
    gap: spacing.lg,
  },

  // Mode cards
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: "hidden",
  },
  cardGradientHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  cardLabel: {
    ...typography.heading,
    color: colors.white,
    flex: 1,
  },
  cardArrow: {
    marginLeft: "auto",
  },
  cardBody: {
    padding: spacing.xl,
    paddingTop: spacing.lg,
  },
  cardDesc: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  featureText: {
    ...typography.caption,
    color: colors.text,
    fontSize: 13,
  },

  // History section
  historySection: {
    marginTop: spacing.xxxl,
  },
  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sectionLabel: {
    ...typography.small,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  seeAllText: {
    ...typography.caption,
    color: colors.primary,
    fontSize: 13,
  },
  historyLoading: {
    marginTop: spacing.xxl,
  },
  historyList: {
    gap: spacing.sm,
  },
  historyCard: {
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

  // Empty state
  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xxxl,
    gap: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
