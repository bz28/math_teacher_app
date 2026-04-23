import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { useColors, spacing, radii, typography, shadows, type ColorPalette } from "../theme";

interface MockTestConfigProps {
  examType: "use_as_exam" | "generate_similar" | "from_objectives";
  onExamTypeChange: (type: "use_as_exam" | "generate_similar" | "from_objectives") => void;
  untimed: boolean;
  onUntimedChange: (untimed: boolean) => void;
  timeLimitMinutes: number;
  onTimeLimitChange: (minutes: number) => void;
  multipleChoice: boolean;
  onMultipleChoiceChange: (mc: boolean) => void;
  /** Subject theme color used for active pill background and stepper accents */
  themeColor?: string;
}

function PillToggle<T extends string>({
  options,
  value,
  onChange,
  themeColor,
  fullWidth = false,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  themeColor: string;
  /** When true, pills flex evenly to fill the parent width (segmented control). */
  fullWidth?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.pillGroup, fullWidth && styles.pillGroupFull]}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <AnimatedPressable
            key={opt.id}
            style={[
              styles.pill,
              fullWidth && styles.pillFlex,
              active && { backgroundColor: themeColor },
            ]}
            onPress={() => onChange(opt.id)}
            scaleDown={0.95}
            accessibilityRole="tab"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[styles.pillText, active && styles.pillTextActive]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

export function MockTestConfig({
  examType,
  onExamTypeChange,
  untimed,
  onUntimedChange,
  timeLimitMinutes,
  onTimeLimitChange,
  multipleChoice,
  onMultipleChoiceChange,
  themeColor,
}: MockTestConfigProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const resolvedThemeColor = themeColor ?? colors.primary;
  return (
    <View style={[styles.card, shadows.sm]}>
      {/* Questions — stacked so the 3 pill labels have room to breathe
          on small screens; keeping them in-row would force ellipsis. */}
      <View style={styles.stackedRow}>
        <Text style={styles.label}>Questions</Text>
        <PillToggle
          options={[
            { id: "use_as_exam" as const, label: "Use mine" },
            { id: "generate_similar" as const, label: "Generate" },
            { id: "from_objectives" as const, label: "Objectives" },
          ]}
          value={examType}
          onChange={onExamTypeChange}
          themeColor={resolvedThemeColor}
          fullWidth
        />
      </View>

      <View style={styles.divider} />

      {/* Time */}
      <View style={styles.row}>
        <Text style={styles.label}>Time</Text>
        <View style={styles.rowRight}>
          <PillToggle
            options={[
              { id: "untimed" as const, label: "Untimed" },
              { id: "timed" as const, label: "Timed" },
            ]}
            value={untimed ? "untimed" : "timed"}
            onChange={(id) => onUntimedChange(id === "untimed")}
            themeColor={resolvedThemeColor}
          />
          {!untimed && (
            <View style={styles.stepper}>
              <AnimatedPressable
                style={[styles.stepperBtn, timeLimitMinutes <= 1 && styles.stepperBtnDisabled]}
                onPress={() => onTimeLimitChange(Math.max(1, timeLimitMinutes - 5))}
                scaleDown={0.9}
                disabled={timeLimitMinutes <= 1}
              >
                <Ionicons name="remove" size={14} color={timeLimitMinutes <= 1 ? colors.textMuted : resolvedThemeColor} />
              </AnimatedPressable>
              <Text style={[styles.stepperValue, { color: resolvedThemeColor }]}>{timeLimitMinutes}m</Text>
              <AnimatedPressable
                style={[styles.stepperBtn, timeLimitMinutes >= 180 && styles.stepperBtnDisabled]}
                onPress={() => onTimeLimitChange(Math.min(180, timeLimitMinutes + 5))}
                scaleDown={0.9}
                disabled={timeLimitMinutes >= 180}
              >
                <Ionicons name="add" size={14} color={timeLimitMinutes >= 180 ? colors.textMuted : resolvedThemeColor} />
              </AnimatedPressable>
            </View>
          )}
        </View>
      </View>

      <View style={styles.divider} />

      {/* Answers */}
      <View style={styles.row}>
        <Text style={styles.label}>Answers</Text>
        <PillToggle
          options={[
            { id: "mc" as const, label: "Multiple choice" },
            { id: "free" as const, label: "Free response" },
          ]}
          value={multipleChoice ? "mc" : "free"}
          onChange={(id) => onMultipleChoiceChange(id === "mc")}
          themeColor={resolvedThemeColor}
        />
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
    marginTop: spacing.lg,
    width: "100%",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 36,
  },
  stackedRow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: spacing.sm,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: spacing.md,
  },
  pillGroup: {
    flexDirection: "row",
    backgroundColor: colors.inputBg,
    borderRadius: radii.pill,
    padding: 3,
  },
  pillGroupFull: {
    alignSelf: "stretch",
  },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
  },
  pillFlex: {
    flex: 1,
    alignItems: "center",
  },
  pillActive: {
    backgroundColor: colors.primary,
  },
  pillText: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: colors.white,
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
    color: colors.primary,
    minWidth: 32,
    textAlign: "center",
    fontSize: 12,
  },
});
