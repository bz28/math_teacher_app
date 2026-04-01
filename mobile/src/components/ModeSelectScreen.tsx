import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { InProgressCard, CompletedCard } from "./HistoryCards";
import { PaywallScreen } from "./PaywallScreen";
import { getSessionHistory, type SessionHistoryItem } from "../services/api";
import { useEntitlementStore } from "../stores/entitlements";
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

export function ModeSelectScreen({ subject, onSelect, onBack, onViewSession, onViewAllHistory }: ModeSelectScreenProps) {
  const [history, setHistory] = useState<SessionHistoryItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const isPro = useEntitlementStore((s) => s.isPro);
  const sessionsRemaining = useEntitlementStore((s) => s.sessionsRemaining);
  const dailySessionsLimit = useEntitlementStore((s) => s.dailySessionsLimit);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);

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
          {MODES.map((mode) => {
            const showSessionCount = !isPro;

            return (
              <AnimatedPressable
                key={mode.id}
                style={[styles.modeCard, shadows.md]}
                onPress={() => {
                  if (!isPro && sessionsRemaining() <= 0) {
                    setPaywallVisible(true);
                    return;
                  }
                  onSelect(mode.id);
                }}
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
                    <View style={styles.modeLabelRow}>
                      <Text style={styles.modeLabel}>{mode.label}</Text>
                    </View>
                    <Text style={styles.modeTagline}>{mode.tagline}</Text>
                    {showSessionCount && (
                      <Text style={styles.modeSessionCount}>
                        {sessionsRemaining()} of {dailySessionsLimit} free sessions left today
                      </Text>
                    )}
                  </View>
                  <Ionicons
                    name="arrow-forward-circle"
                    size={22}
                    color="rgba(255,255,255,0.7)"
                  />
                </LinearGradient>
              </AnimatedPressable>
            );
          })}
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

      <PaywallScreen
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        onPurchaseComplete={() => { setPaywallVisible(false); fetchEntitlements(); }}
        trigger="create_session"
      />
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
  modeLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  proBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  proBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.white,
    letterSpacing: 0.5,
  },
  modeTagline: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    marginTop: 2,
  },
  modeSessionCount: {
    fontSize: 11,
    color: "rgba(255,255,255,0.65)",
    marginTop: 3,
    fontWeight: "500",
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
