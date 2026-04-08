import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { InProgressCard, CompletedCard } from "./HistoryCards";
import { SubjectPills } from "./SubjectPills";
import { getSessionHistory, type SessionHistoryItem } from "../services/api";
import { colors, spacing, typography } from "../theme";

interface HistoryListScreenProps {
  subject: string;
  onSubjectChange: (s: string) => void;
  onBack: () => void;
  onViewSession: (sessionId: string) => void;
}

const PAGE_SIZE = 20;

export function HistoryListScreen({ subject, onSubjectChange, onBack, onViewSession }: HistoryListScreenProps) {
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

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
        setError(false);
      } catch {
        setError(true);
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
  const inProgress = items.filter((s) => s.status === "active");
  const completed = items.filter((s) => s.status !== "active");

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <SubjectPills active={subject} onChange={onSubjectChange} />

      <Text style={styles.title}>{subjectLabel} History</Text>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.centered} />
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Couldn't load history</Text>
          <AnimatedPressable onPress={() => { setLoading(true); setError(false); fetchPage(0).then((res) => { setItems(res.items); setHasMore(res.has_more); }).catch(() => setError(true)).finally(() => setLoading(false)); }}>
            <Text style={{ color: colors.primary, ...typography.bodyBold, fontSize: 14 }}>Try Again</Text>
          </AnimatedPressable>
        </View>
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
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  backButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  backText: { color: colors.primary, ...typography.bodyBold },
  title: {
    ...typography.hero,
    color: colors.text,
    marginBottom: spacing.xxl,
    paddingHorizontal: spacing.xl,
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
