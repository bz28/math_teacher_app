import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { colors, spacing, radii, typography, shadows } from "../theme";

interface MockTestConfigProps {
  examType: "use_as_exam" | "generate_similar";
  onExamTypeChange: (type: "use_as_exam" | "generate_similar") => void;
  untimed: boolean;
  onUntimedChange: (untimed: boolean) => void;
  timeLimitMinutes: number;
  onTimeLimitChange: (minutes: number) => void;
  multipleChoice: boolean;
  onMultipleChoiceChange: (mc: boolean) => void;
}

function PillToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <View style={styles.pillGroup}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <AnimatedPressable
            key={opt.id}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onChange(opt.id)}
            scaleDown={0.95}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>
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
}: MockTestConfigProps) {
  return (
    <View style={[styles.card, shadows.sm]}>
      {/* Questions */}
      <View style={styles.row}>
        <Text style={styles.label}>Questions</Text>
        <PillToggle
          options={[
            { id: "use_as_exam" as const, label: "Use mine" },
            { id: "generate_similar" as const, label: "Generate" },
          ]}
          value={examType}
          onChange={onExamTypeChange}
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
          />
          {!untimed && (
            <View style={styles.stepper}>
              <AnimatedPressable
                style={[styles.stepperBtn, timeLimitMinutes <= 1 && styles.stepperBtnDisabled]}
                onPress={() => onTimeLimitChange(Math.max(1, timeLimitMinutes - 5))}
                scaleDown={0.9}
                disabled={timeLimitMinutes <= 1}
              >
                <Ionicons name="remove" size={14} color={timeLimitMinutes <= 1 ? colors.textMuted : colors.primary} />
              </AnimatedPressable>
              <Text style={styles.stepperValue}>{timeLimitMinutes}m</Text>
              <AnimatedPressable
                style={[styles.stepperBtn, timeLimitMinutes >= 180 && styles.stepperBtnDisabled]}
                onPress={() => onTimeLimitChange(Math.min(180, timeLimitMinutes + 5))}
                scaleDown={0.9}
                disabled={timeLimitMinutes >= 180}
              >
                <Ionicons name="add" size={14} color={timeLimitMinutes >= 180 ? colors.textMuted : colors.primary} />
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
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
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
