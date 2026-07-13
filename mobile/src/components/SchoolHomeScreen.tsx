import { useEffect, useMemo } from "react";
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { Eyebrow } from "./Eyebrow";
import { ListSkeleton } from "./SkeletonLoader";
import {
  getSchoolDashboard,
  type SchoolAssignment,
  type SchoolGrade,
} from "../services/api";
import { useCachedResource } from "../hooks/useCachedResource";
import { scoreColor } from "../utils/scoreColor";
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";

interface Props {
  /** Push the "join another class" flow. */
  onJoinClass: () => void;
  /** Open a homework assignment (view problems + submit). */
  onOpenAssignment: (assignmentId: string) => void;
}

/**
 * Classroom home for a school-enrolled student. Surfaces the dashboard
 * the web app shows: overdue work first (so it can't be missed), then
 * what's due this week, what's submitted-and-waiting, and recent grades.
 * Read-only in this chunk — opening an assignment to submit arrives next.
 */
export function SchoolHomeScreen({ onJoinClass, onOpenAssignment }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data, loading, refreshing, error, load, setRefreshing } = useCachedResource(
    "school-dashboard",
    getSchoolDashboard,
  );

  // Refetch when the app returns to the foreground so a student who left the
  // dashboard open doesn't come back to stale due dates / grades.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") load();
    });
    return () => sub.remove();
  }, [load]);

  const isEmpty =
    data != null &&
    data.due_this_week.length === 0 &&
    data.overdue.length === 0 &&
    data.in_review.length === 0 &&
    data.recently_graded.length === 0;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Eyebrow style={styles.headerEyebrow}>Your classes</Eyebrow>
          <AnimatedPressable
            style={styles.joinButton}
            onPress={onJoinClass}
            accessibilityRole="button"
            accessibilityLabel="Join a class"
          >
            <Ionicons name="add" size={16} color={colors.primary} />
            <Text style={styles.joinText}>Join a class</Text>
          </AnimatedPressable>
        </View>
        <Text style={styles.title}>
          {data?.first_name ? `Hi, ${data.first_name}.` : "Welcome back."}
        </Text>
      </View>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Couldn't load your classes</Text>
          <AnimatedPressable onPress={() => load()}>
            <Text style={styles.retryText}>Try again</Text>
          </AnimatedPressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.primary}
            />
          }
        >
          {isEmpty ? (
            <View style={styles.emptyBlock}>
              <Ionicons name="sparkles-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>You're all caught up</Text>
              <Text style={styles.emptyText}>
                Nothing due right now. New homework from your teacher will show up here.
              </Text>
            </View>
          ) : (
            <>
              <Section title="Overdue" tone="error" items={data!.overdue} colors={colors} styles={styles} onOpen={onOpenAssignment} />
              <Section title="Due this week" items={data!.due_this_week} colors={colors} styles={styles} onOpen={onOpenAssignment} />
              <Section title="In review" items={data!.in_review} colors={colors} styles={styles} muted onOpen={onOpenAssignment} />
              <GradedSection items={data!.recently_graded} colors={colors} styles={styles} onOpen={onOpenAssignment} />
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Section({
  title,
  items,
  colors,
  styles,
  tone,
  muted,
  onOpen,
}: {
  title: string;
  items: SchoolAssignment[];
  colors: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
  tone?: "error";
  muted?: boolean;
  onOpen: (assignmentId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, tone === "error" && { color: colors.error }]}>{title}</Text>
      {items.map((a) => (
        <AnimatedPressable
          key={a.assignment_id}
          style={styles.row}
          onPress={() => onOpen(a.assignment_id)}
          accessibilityRole="button"
          accessibilityLabel={a.title}
        >
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={1}>{a.title}</Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {a.course_name} · {a.section_name}
            </Text>
          </View>
          {muted ? (
            <Text style={styles.rowStatus}>Submitted</Text>
          ) : (
            <Text style={[styles.rowStatus, tone === "error" && { color: colors.error }]}>
              {tone === "error" ? (a.is_late ? "Late" : "Overdue") : formatDue(a.due_at)}
            </Text>
          )}
        </AnimatedPressable>
      ))}
    </View>
  );
}

function GradedSection({
  items,
  colors,
  styles,
  onOpen,
}: {
  items: SchoolGrade[];
  colors: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
  onOpen: (assignmentId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Recently graded</Text>
      {items.map((g) => (
        <AnimatedPressable
          key={g.assignment_id}
          style={styles.row}
          onPress={() => onOpen(g.assignment_id)}
          accessibilityRole="button"
          accessibilityLabel={g.title}
        >
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={1}>{g.title}</Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {g.course_name} · {g.section_name}
            </Text>
          </View>
          <Text style={[styles.score, { color: scoreColor(g.final_score, colors) }]}>
            {Math.round(g.final_score)}%
          </Text>
        </AnimatedPressable>
      ))}
    </View>
  );
}

function formatDue(iso: string | null): string {
  if (!iso) return "No due date";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  headerEyebrow: {},
  joinButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  joinText: { ...typography.label, color: colors.primary, fontSize: 13 },
  title: {
    ...typography.displaySerifItalic,
    fontSize: 28,
    lineHeight: 34,
    color: colors.text,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  section: { gap: spacing.sm },
  sectionLabel: {
    ...typography.eyebrow,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { ...typography.body, fontSize: 15, color: colors.text },
  rowMeta: { ...typography.caption, color: colors.textMuted, fontSize: 12 },
  rowStatus: { ...typography.label, color: colors.textSecondary, fontSize: 12 },
  score: { ...typography.bodyBold, fontSize: 16 },

  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xxxl,
    gap: spacing.md,
  },
  emptyBlock: {
    alignItems: "center",
    paddingTop: spacing.xxxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: {
    ...typography.displaySerifItalic,
    fontSize: 22,
    lineHeight: 26,
    color: colors.text,
    marginTop: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    fontSize: 14,
  },
  retryText: { ...typography.bodyBold, color: colors.primary, fontSize: 14 },
});
