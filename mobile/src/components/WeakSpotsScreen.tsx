import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { Eyebrow } from "./Eyebrow";
import { MathText } from "./MathText";
import { SubjectPills } from "./SubjectPills";
import { getWeakSpots, type WeakSpotItem } from "../services/api";
import { useSessionStore } from "../stores/session";
import { useColors, spacing, typography, radii, shadows, type ColorPalette } from "../theme";

interface Props {
  subject: string;
  onSubjectChange: (s: string) => void;
  /** Called after startPracticeBatch resolves so the host can navigate into
   *  the session screen where the practice flow renders. */
  onStartPractice: () => void;
}

const PRACTICE_COUNT = 5;

/**
 * Replaces the old Library tab. Surfaces problems where the student's
 * submitted work was flagged by the diagnosis pipeline, grouped by
 * problem text. Each card offers a one-tap "Practice 5 similar" CTA
 * that seeds a batch off the flagged problem and lands the user in the
 * practice flow.
 */
export function WeakSpotsScreen({ subject, onSubjectChange, onStartPractice }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<WeakSpotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const startPracticeBatch = useSessionStore((s) => s.startPracticeBatch);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await getWeakSpots(subject);
      setItems(res.items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [subject]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePractice = async (item: WeakSpotItem) => {
    if (generatingFor) return;
    setGeneratingFor(item.problem_text);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await startPracticeBatch(item.problem_text, PRACTICE_COUNT);
      onStartPractice();
    } catch {
      // startPracticeBatch already sets store error state; surface nothing
      // extra here so the screen keeps the list visible.
    } finally {
      setGeneratingFor(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <SubjectPills active={subject} onChange={onSubjectChange} />

      <View style={styles.header}>
        <Eyebrow style={styles.headerEyebrow}>Review</Eyebrow>
        <Text style={styles.title}>What tripped you up.</Text>
        <Text style={styles.subtitle}>
          Mock-test problems where your attached work got flagged. Tap to practice more like them.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.centered} />
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Couldn't load your review list</Text>
          <AnimatedPressable onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </AnimatedPressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="ribbon-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Nothing flagged yet</Text>
          <Text style={styles.emptyText}>
            Take a mock test and attach a photo of your handwritten work — anything our
            diagnosis flags lands here for targeted practice.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {items.map((item) => (
            <WeakSpotCard
              key={`${item.problem_text}-${item.submitted_at}`}
              item={item}
              busy={generatingFor === item.problem_text}
              anyBusy={generatingFor !== null}
              onPress={() => handlePractice(item)}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function WeakSpotCard({
  item,
  busy,
  anyBusy,
  onPress,
}: {
  item: WeakSpotItem;
  busy: boolean;
  anyBusy: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const relative = useMemo(() => formatRelative(item.submitted_at), [item.submitted_at]);

  return (
    <View style={[styles.card, shadows.sm]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardRelative}>{relative}</Text>
        {item.issue_count > 1 && (
          <View style={styles.countBadge}>
            <Ionicons name="repeat" size={12} color={colors.warningDark} />
            <Text style={styles.countText}>{item.issue_count}x</Text>
          </View>
        )}
      </View>

      <MathText
        text={item.problem_text}
        style={{ ...typography.body, fontSize: 15, color: colors.text }}
        numberOfLines={3}
      />

      <View style={styles.summaryRow}>
        <Ionicons name="alert-circle-outline" size={14} color={colors.warningDark} />
        <Text style={styles.summaryText} numberOfLines={2}>
          {item.summary}
        </Text>
      </View>

      <AnimatedPressable
        style={[styles.cta, anyBusy && !busy && styles.ctaDisabled]}
        onPress={onPress}
        disabled={anyBusy}
        scaleDown={0.97}
        accessibilityRole="button"
        accessibilityLabel={`Practice ${PRACTICE_COUNT} similar problems`}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.textOnPrimary} />
        ) : (
          <>
            <Ionicons name="sparkles" size={14} color={colors.textOnPrimary} />
            <Text style={styles.ctaText}>Practice {PRACTICE_COUNT} similar</Text>
          </>
        )}
      </AnimatedPressable>
    </View>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString();
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  headerEyebrow: { marginBottom: spacing.sm },
  title: {
    ...typography.displaySerifItalic,
    fontSize: 28,
    lineHeight: 34,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: { ...typography.body, color: colors.textSecondary, fontSize: 14 },

  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardRelative: {
    ...typography.eyebrow,
    fontSize: 10,
    color: colors.textMuted,
  },
  countBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.warningBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  countText: {
    ...typography.label,
    color: colors.warningDark,
    fontSize: 11,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  summaryText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: {
    ...typography.label,
    color: colors.textOnPrimary,
    fontSize: 13,
  },

  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xxxl,
    gap: spacing.md,
  },
  emptyTitle: {
    ...typography.displaySerifItalic,
    fontSize: 22,
    lineHeight: 26,
    color: colors.text,
    marginTop: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    fontSize: 14,
  },
  retryText: {
    ...typography.bodyBold,
    color: colors.primary,
    fontSize: 14,
  },
});
