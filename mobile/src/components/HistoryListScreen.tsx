import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { getSessionHistory, type SessionHistoryItem } from "../services/api";
import { colors, spacing, radii, typography, shadows } from "../theme";

interface HistoryListScreenProps {
  subject: string;
  onBack: () => void;
  onViewSession: (sessionId: string) => void;
}

const PAGE_SIZE = 20;

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
  return (
    <AnimatedPressable style={[styles.completedCard, shadows.sm]} onPress={onPress} scaleDown={0.98}>
      <Ionicons name="checkmark-circle" size={20} color={colors.success} style={styles.historyIcon} />
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

export function HistoryListScreen({ subject, onBack, onViewSession }: HistoryListScreenProps) {
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(async (offset: number) => {
    const res = await getSessionHistory(subject, PAGE_SIZE, offset);
    return res;
  }, [subject]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchPage(0);
        setItems(res.items);
        setHasMore(res.has_more);
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchPage]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchPage(items.length);
      setItems((prev) => [...prev, ...res.items]);
      setHasMore(res.has_more);
    } catch {
      // Silently fail
    } finally {
      setLoadingMore(false);
    }
  };

  const subjectLabel = subject.charAt(0).toUpperCase() + subject.slice(1);
  const inProgress = items.filter((s) => s.status !== "completed");
  const completed = items.filter((s) => s.status === "completed");

  return (
    <SafeAreaView style={styles.container}>
      <AnimatedPressable style={styles.backButton} onPress={onBack}>
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </AnimatedPressable>

      <Text style={styles.title}>{subjectLabel} History</Text>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.centered} />
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="book-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>No sessions yet</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* Continue Learning */}
          {inProgress.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>CONTINUE LEARNING</Text>
              <View style={styles.historyList}>
                {inProgress.map((item) => (
                  <InProgressCard
                    key={item.id}
                    item={item}
                    onPress={() => onViewSession(item.id)}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Completed */}
          {completed.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>COMPLETED</Text>
              <View style={styles.historyList}>
                {completed.map((item) => (
                  <CompletedCard
                    key={item.id}
                    item={item}
                    onPress={() => onViewSession(item.id)}
                  />
                ))}
              </View>
            </View>
          )}

          {hasMore && (
            <AnimatedPressable style={styles.loadMoreButton} onPress={loadMore}>
              {loadingMore ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.loadMoreText}>Load More</Text>
              )}
            </AnimatedPressable>
          )}
        </ScrollView>
      )}
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
  title: {
    ...typography.hero,
    color: colors.text,
    marginBottom: spacing.xxl,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
  },

  // Sections
  section: {
    marginBottom: spacing.xxl,
  },
  sectionLabel: {
    ...typography.small,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  historyList: {
    gap: spacing.sm,
  },

  // In-progress card
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

  // Load more
  loadMoreButton: {
    alignItems: "center",
    paddingVertical: spacing.lg,
  },
  loadMoreText: {
    ...typography.bodyBold,
    color: colors.primary,
    fontSize: 14,
  },
});
