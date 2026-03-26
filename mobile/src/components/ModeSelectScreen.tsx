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
  tagline: string;
}

const MODES: ModeConfig[] = [
  {
    id: "learn",
    label: "Learn",
    icon: "book",
    gradient: gradients.primary,
    tagline: "Step-by-step guided learning",
  },
  {
    id: "mock_test",
    label: "Mock Test",
    icon: "document-text",
    gradient: gradients.warning,
    tagline: "Practice or generate an exam",
  },
];

const HISTORY_PREVIEW_LIMIT = 20;
const SECTION_PREVIEW_LIMIT = 3;

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

function InProgressCard({ item, onPress }: { item: SessionHistoryItem; onPress: () => void }) {
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

function CompletedCard({ item, onPress }: { item: SessionHistoryItem; onPress: () => void }) {
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

  const inProgress = history.filter((s) => s.status === "active");
  const completed = history.filter((s) => s.status !== "active");

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

        {/* Compact mode cards */}
        <View style={styles.modeList}>
          {MODES.map((mode) => (
            <AnimatedPressable
              key={mode.id}
              style={[styles.modeCard, shadows.md]}
              onPress={() => onSelect(mode.id)}
              scaleDown={0.97}
            >
              <LinearGradient
                colors={mode.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.modeGradient}
              >
                <Ionicons name={mode.icon} size={22} color={colors.white} />
                <View style={styles.modeTextWrap}>
                  <Text style={styles.modeLabel}>{mode.label}</Text>
                  <Text style={styles.modeTagline}>{mode.tagline}</Text>
                </View>
                <Ionicons name="arrow-forward-circle" size={22} color="rgba(255,255,255,0.7)" />
              </LinearGradient>
            </AnimatedPressable>
          ))}
        </View>

        {/* History sections */}
        {loading ? (
          <ActivityIndicator size="small" color={colors.primary} style={styles.historyLoading} />
        ) : history.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="book-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyText}>No sessions yet — start learning{"\n"}and your progress will show up here!</Text>
          </View>
        ) : (
          <>
            {/* Continue Learning */}
            {inProgress.length > 0 && (
              <View style={styles.historySection}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionLabel}>CONTINUE LEARNING</Text>
                  {inProgress.length > SECTION_PREVIEW_LIMIT && (
                    <AnimatedPressable onPress={onViewAllHistory}>
                      <Text style={styles.seeAllText}>See All</Text>
                    </AnimatedPressable>
                  )}
                </View>
                <View style={styles.historyList}>
                  {inProgress.slice(0, SECTION_PREVIEW_LIMIT).map((item) => (
                    <InProgressCard
                      key={item.id}
                      item={item}
                      onPress={() => onViewSession(item.id)}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Completed / Abandoned */}
            {completed.length > 0 && (
              <View style={styles.historySection}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionLabel}>COMPLETED</Text>
                  {(completed.length > SECTION_PREVIEW_LIMIT || hasMore) && (
                    <AnimatedPressable onPress={onViewAllHistory}>
                      <Text style={styles.seeAllText}>See All</Text>
                    </AnimatedPressable>
                  )}
                </View>
                <View style={styles.historyList}>
                  {completed.slice(0, SECTION_PREVIEW_LIMIT).map((item) => (
                    <CompletedCard
                      key={item.id}
                      item={item}
                      onPress={() => onViewSession(item.id)}
                    />
                  ))}
                </View>
              </View>
            )}
          </>
        )}
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

  // Compact mode cards
  modeList: {
    gap: spacing.md,
  },
  modeCard: {
    borderRadius: radii.xl,
    overflow: "hidden",
  },
  modeGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  modeTextWrap: {
    flex: 1,
  },
  modeLabel: {
    ...typography.bodyBold,
    color: colors.white,
    fontSize: 17,
  },
  modeTagline: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    marginTop: 2,
  },

  // History sections
  historySection: {
    marginTop: spacing.xxl,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sectionLabel: {
    ...typography.small,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  seeAllText: {
    ...typography.caption,
    color: colors.primary,
    fontSize: 13,
    marginBottom: spacing.md,
  },
  historyLoading: {
    marginTop: spacing.xxxl,
  },
  historyList: {
    gap: spacing.sm,
  },

  // In-progress card — left accent border replaces separate accent view
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

  // Completed card
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
