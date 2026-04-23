import { useMemo } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { useColors, spacing, radii, typography, shadows, type ColorPalette } from "../theme";
import type { ObjectivesLevel } from "../services/api";

interface Props {
  courseName: string;
  onCourseNameChange: (value: string) => void;
  level: ObjectivesLevel | null;
  onLevelChange: (level: ObjectivesLevel | null) => void;
  questionCount: number;
  onQuestionCountChange: (count: number) => void;
  /** Subject theme color for active pill + stepper accents. */
  themeColor?: string;
}

const LEVEL_OPTIONS: { id: ObjectivesLevel; label: string }[] = [
  { id: "middle", label: "Middle" },
  { id: "hs", label: "HS" },
  { id: "college", label: "College" },
  { id: "other", label: "Other" },
];

const MIN_COUNT = 1;
const MAX_COUNT = 20;

export function ObjectivesSheetCard({
  courseName,
  onCourseNameChange,
  level,
  onLevelChange,
  questionCount,
  onQuestionCountChange,
  themeColor,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const resolvedTheme = themeColor ?? colors.primary;

  return (
    <View style={[styles.card, shadows.sm]}>
      <View style={styles.header}>
        <Ionicons name="list-outline" size={16} color={colors.textSecondary} />
        <Text style={styles.headerText}>Exam details (optional)</Text>
      </View>

      {/* Course name */}
      <View style={styles.field}>
        <Text style={styles.label}>Course</Text>
        <TextInput
          style={styles.input}
          value={courseName}
          onChangeText={onCourseNameChange}
          placeholder="e.g., AP Calc BC, Alg 2 Honors"
          placeholderTextColor={colors.textMuted}
          maxLength={80}
          returnKeyType="done"
          // Course names are proper nouns ("AP Calc BC", "Alg 2 Honors");
          // autocorrect would mangle abbreviations and sentence-case would
          // rewrite "AP" to "Ap".
          autoCorrect={false}
          autoCapitalize="words"
          accessibilityLabel="Course name"
        />
      </View>

      <View style={styles.divider} />

      {/* Level */}
      <View style={styles.rowInline}>
        <Text style={styles.label}>Level</Text>
        <View style={styles.levelRow}>
          {LEVEL_OPTIONS.map((opt) => {
            const active = opt.id === level;
            return (
              <AnimatedPressable
                key={opt.id}
                style={[styles.levelPill, active && { backgroundColor: resolvedTheme }]}
                onPress={() => onLevelChange(active ? null : opt.id)}
                scaleDown={0.95}
                accessibilityRole="tab"
                accessibilityLabel={opt.label}
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.levelText, active && styles.levelTextActive]}
                  numberOfLines={1}
                >
                  {opt.label}
                </Text>
              </AnimatedPressable>
            );
          })}
        </View>
      </View>

      <View style={styles.divider} />

      {/* # questions */}
      <View style={styles.rowInline}>
        <Text style={styles.label}>Questions</Text>
        <View style={styles.stepper}>
          <AnimatedPressable
            style={[styles.stepperBtn, questionCount <= MIN_COUNT && styles.stepperBtnDisabled]}
            onPress={() => onQuestionCountChange(Math.max(MIN_COUNT, questionCount - 1))}
            scaleDown={0.9}
            disabled={questionCount <= MIN_COUNT}
            accessibilityLabel="Decrease question count"
          >
            <Ionicons
              name="remove"
              size={14}
              color={questionCount <= MIN_COUNT ? colors.textMuted : resolvedTheme}
            />
          </AnimatedPressable>
          <Text style={[styles.stepperValue, { color: resolvedTheme }]}>{questionCount}</Text>
          <AnimatedPressable
            style={[styles.stepperBtn, questionCount >= MAX_COUNT && styles.stepperBtnDisabled]}
            onPress={() => onQuestionCountChange(Math.min(MAX_COUNT, questionCount + 1))}
            scaleDown={0.9}
            disabled={questionCount >= MAX_COUNT}
            accessibilityLabel="Increase question count"
          >
            <Ionicons
              name="add"
              size={14}
              color={questionCount >= MAX_COUNT ? colors.textMuted : resolvedTheme}
            />
          </AnimatedPressable>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.lg,
    marginTop: spacing.md,
    width: "100%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  headerText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
  },
  field: {
    gap: spacing.sm,
  },
  rowInline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 36,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.inputBg,
  },
  levelRow: {
    flexDirection: "row",
    backgroundColor: colors.inputBg,
    borderRadius: radii.pill,
    padding: 3,
  },
  levelPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    alignItems: "center",
  },
  levelText: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
  },
  levelTextActive: {
    color: colors.white,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: spacing.md,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputBg,
    borderRadius: radii.pill,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  stepperBtnDisabled: {
    opacity: 0.35,
  },
  stepperValue: {
    ...typography.label,
    minWidth: 32,
    textAlign: "center",
    fontSize: 12,
  },
});
