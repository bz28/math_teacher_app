import { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { Eyebrow } from "./Eyebrow";
import { ListSkeleton } from "./SkeletonLoader";
import { getSchoolGrades, type SchoolGrade } from "../services/api";
import { useCachedResource } from "../hooks/useCachedResource";
import { averageScore } from "../utils/grades";
import { scoreColor } from "../utils/scoreColor";
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";

// Stable empty reference so the `average` memo doesn't recompute every render
// while the cache is still cold.
const NO_GRADES: SchoolGrade[] = [];

interface Props {
  /** Open the graded homework for a tapped grade row. */
  onOpenGrade: (assignmentId: string) => void;
}

/** Every published grade across the student's enrolled courses, newest first. */
export function GradesScreen({ onOpenGrade }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data, loading, refreshing, error, load, setRefreshing } = useCachedResource(
    "school-grades",
    async () => (await getSchoolGrades()).grades,
  );
  const grades = data ?? NO_GRADES;

  const average = useMemo(() => averageScore(grades.map((g) => g.final_score)), [grades]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Eyebrow style={styles.headerEyebrow}>Grades</Eyebrow>
        <Text style={styles.title}>Your grades.</Text>
        {average != null && (
          <Text style={styles.average}>
            Average{" "}
            <Text style={[styles.averageValue, { color: scoreColor(average, colors) }]}>
              {average}%
            </Text>{" "}
            across {grades.length} {grades.length === 1 ? "grade" : "grades"}
          </Text>
        )}
      </View>

      {loading ? (
        <ListSkeleton rows={5} />
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Couldn't load your grades</Text>
          <AnimatedPressable onPress={() => load()}>
            <Text style={styles.retryText}>Try again</Text>
          </AnimatedPressable>
        </View>
      ) : grades.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="ribbon-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No grades yet</Text>
          <Text style={styles.emptyText}>
            Graded work from your teachers will appear here once it's published.
          </Text>
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
                load(true);
              }}
              tintColor={colors.primary}
            />
          }
        >
          {grades.map((g) => (
            <AnimatedPressable
              key={g.assignment_id}
              style={styles.row}
              onPress={() => onOpenGrade(g.assignment_id)}
              accessibilityRole="button"
              accessibilityLabel={`${g.title}, ${Math.round(g.final_score)} percent. Open to review your graded work.`}
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
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </AnimatedPressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
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
  average: { ...typography.body, color: colors.textSecondary, fontSize: 14 },
  averageValue: { ...typography.bodyBold },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.sm,
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
  score: { ...typography.bodyBold, fontSize: 16 },
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
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: "center", fontSize: 14 },
  retryText: { ...typography.bodyBold, color: colors.primary, fontSize: 14 },
});
