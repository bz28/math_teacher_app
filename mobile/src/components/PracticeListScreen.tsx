import { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { Eyebrow } from "./Eyebrow";
import { ListSkeleton } from "./SkeletonLoader";
import {
  getCoursePractice,
  getStudentClasses,
  type PracticeSet,
  type StudentClass,
} from "../services/api";
import { useCachedResource } from "../hooks/useCachedResource";
import { uniqueCourses } from "../utils/practiceCheck";
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";

interface Props {
  onOpenPractice: (assignmentId: string, title: string) => void;
}

interface CourseGroup {
  course: StudentClass;
  sets: PracticeSet[];
}

const NO_GROUPS: CourseGroup[] = [];

/** Teacher-assigned practice grouped by course; courses with no sets drop out. */
async function loadPracticeGroups(): Promise<CourseGroup[]> {
  const courses = uniqueCourses(await getStudentClasses());
  // allSettled so one course's failed fetch doesn't blank the whole list.
  const settled = await Promise.allSettled(courses.map((c) => getCoursePractice(c.course_id)));
  const sets = settled.map((r) => (r.status === "fulfilled" ? r.value : []));
  return courses.map((course, i) => ({ course, sets: sets[i] })).filter((g) => g.sets.length > 0);
}

/**
 * The school student's "Practice" tab — teacher-assigned, ungraded practice
 * sets across their courses. This is the sanctioned practice surface that
 * replaces the open-ended Study tab (which was a homework-cheating vector).
 */
export function PracticeListScreen({ onOpenPractice }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data, loading, refreshing, error, load, setRefreshing } = useCachedResource(
    "school-practice",
    loadPracticeGroups,
  );
  const groups = data ?? NO_GROUPS;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Eyebrow style={styles.headerEyebrow}>Practice</Eyebrow>
        <Text style={styles.title}>Practice sets.</Text>
        <Text style={styles.subtitle}>Ungraded practice your teachers assigned — work through them to build confidence.</Text>
      </View>

      {loading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Couldn't load your practice</Text>
          <AnimatedPressable onPress={() => load()}>
            <Text style={styles.retryText}>Try again</Text>
          </AnimatedPressable>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="barbell-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No practice yet</Text>
          <Text style={styles.emptyText}>When a teacher assigns practice, it'll show up here.</Text>
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
          {groups.map((g) => (
            <View key={g.course.course_id} style={styles.section}>
              <Text style={styles.sectionLabel}>{g.course.course_name}</Text>
              {g.sets.map((s) => (
                <AnimatedPressable
                  key={s.assignment_id}
                  style={styles.row}
                  onPress={() => onOpenPractice(s.assignment_id, s.title)}
                  accessibilityRole="button"
                  accessibilityLabel={s.title}
                >
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{s.title}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {s.problem_count} {s.problem_count === 1 ? "problem" : "problems"}
                      {s.source_homework_title ? ` · from ${s.source_homework_title}` : ""}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </AnimatedPressable>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg },
  headerEyebrow: { marginBottom: spacing.sm },
  title: {
    ...typography.displaySerifItalic,
    fontSize: 28,
    lineHeight: 34,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: { ...typography.body, color: colors.textSecondary, fontSize: 14 },
  scrollContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.xl },
  section: { gap: spacing.sm },
  sectionLabel: { ...typography.eyebrow, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.xs },
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
  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xxxl, gap: spacing.md },
  emptyTitle: { ...typography.displaySerifItalic, fontSize: 22, lineHeight: 26, color: colors.text, marginTop: spacing.md },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: "center", fontSize: 14 },
  retryText: { ...typography.bodyBold, color: colors.primary, fontSize: 14 },
});
