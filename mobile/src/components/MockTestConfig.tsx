import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { colors, spacing, radii, typography } from "../theme";

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
    <View style={styles.mockConfig}>
      {/* Questions */}
      <Text style={styles.mockSectionLabel}>QUESTIONS</Text>
      <AnimatedPressable
        style={[styles.mockRadioCard, examType === "use_as_exam" && styles.mockRadioCardActive]}
        onPress={() => onExamTypeChange("use_as_exam")}
        scaleDown={0.98}
      >
        <View style={[styles.mockRadioDot, examType === "use_as_exam" && styles.mockRadioDotActive]}>
          {examType === "use_as_exam" && <View style={styles.mockRadioDotInner} />}
        </View>
        <Text style={[styles.mockRadioLabel, examType === "use_as_exam" && styles.mockRadioLabelActive]}>
          Use these as my exam
        </Text>
      </AnimatedPressable>
      <AnimatedPressable
        style={[styles.mockRadioCard, examType === "generate_similar" && styles.mockRadioCardActive]}
        onPress={() => onExamTypeChange("generate_similar")}
        scaleDown={0.98}
      >
        <View style={[styles.mockRadioDot, examType === "generate_similar" && styles.mockRadioDotActive]}>
          {examType === "generate_similar" && <View style={styles.mockRadioDotInner} />}
        </View>
        <View style={styles.mockRadioTextWrap}>
          <Text style={[styles.mockRadioLabel, examType === "generate_similar" && styles.mockRadioLabelActive]}>
            Generate a similar exam
          </Text>
          <Text style={styles.mockRadioHint}>Fresh questions based on yours</Text>
        </View>
      </AnimatedPressable>

      {/* Time limit */}
      <Text style={[styles.mockSectionLabel, { marginTop: spacing.xl }]}>TIME LIMIT</Text>
      <AnimatedPressable
        style={[styles.mockRadioCard, untimed && styles.mockRadioCardActive]}
        onPress={() => onUntimedChange(true)}
        scaleDown={0.98}
      >
        <View style={[styles.mockRadioDot, untimed && styles.mockRadioDotActive]}>
          {untimed && <View style={styles.mockRadioDotInner} />}
        </View>
        <Text style={[styles.mockRadioLabel, untimed && styles.mockRadioLabelActive]}>
          No time limit
        </Text>
      </AnimatedPressable>
      <AnimatedPressable
        style={[styles.mockRadioCard, !untimed && styles.mockRadioCardActive]}
        onPress={() => onUntimedChange(false)}
        scaleDown={0.98}
      >
        <View style={[styles.mockRadioDot, !untimed && styles.mockRadioDotActive]}>
          {!untimed && <View style={styles.mockRadioDotInner} />}
        </View>
        <Text style={[styles.mockRadioLabel, !untimed && styles.mockRadioLabelActive]}>
          Timed
        </Text>
        {!untimed && (
          <View style={styles.mockTimeStepper}>
            <AnimatedPressable
              style={[styles.mockStepperBtn, timeLimitMinutes <= 1 && styles.mockStepperBtnDisabled]}
              onPress={() => onTimeLimitChange(Math.max(1, timeLimitMinutes - 5))}
              scaleDown={0.9}
              disabled={timeLimitMinutes <= 1}
            >
              <Ionicons name="remove" size={14} color={timeLimitMinutes <= 1 ? colors.textMuted : colors.primary} />
            </AnimatedPressable>
            <Text style={styles.mockStepperValue}>{timeLimitMinutes} min</Text>
            <AnimatedPressable
              style={[styles.mockStepperBtn, timeLimitMinutes >= 180 && styles.mockStepperBtnDisabled]}
              onPress={() => onTimeLimitChange(Math.min(180, timeLimitMinutes + 5))}
              scaleDown={0.9}
              disabled={timeLimitMinutes >= 180}
            >
              <Ionicons name="add" size={14} color={timeLimitMinutes >= 180 ? colors.textMuted : colors.primary} />
            </AnimatedPressable>
          </View>
        )}
      </AnimatedPressable>

      {/* Answer format */}
      <Text style={[styles.mockSectionLabel, { marginTop: spacing.xl }]}>ANSWERS</Text>
      <AnimatedPressable
        style={[styles.mockRadioCard, multipleChoice && styles.mockRadioCardActive]}
        onPress={() => onMultipleChoiceChange(true)}
        scaleDown={0.98}
      >
        <View style={[styles.mockRadioDot, multipleChoice && styles.mockRadioDotActive]}>
          {multipleChoice && <View style={styles.mockRadioDotInner} />}
        </View>
        <Text style={[styles.mockRadioLabel, multipleChoice && styles.mockRadioLabelActive]}>
          Multiple choice
        </Text>
      </AnimatedPressable>
      <AnimatedPressable
        style={[styles.mockRadioCard, !multipleChoice && styles.mockRadioCardActive]}
        onPress={() => onMultipleChoiceChange(false)}
        scaleDown={0.98}
      >
        <View style={[styles.mockRadioDot, !multipleChoice && styles.mockRadioDotActive]}>
          {!multipleChoice && <View style={styles.mockRadioDotInner} />}
        </View>
        <Text style={[styles.mockRadioLabel, !multipleChoice && styles.mockRadioLabelActive]}>
          Free response
        </Text>
      </AnimatedPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  mockConfig: {
    marginTop: spacing.lg,
    width: "100%",
  },
  mockSectionLabel: {
    ...typography.small,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  mockRadioCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.borderLight,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  mockRadioCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryBg,
  },
  mockRadioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.textMuted,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  mockRadioDotActive: {
    borderColor: colors.primary,
  },
  mockRadioDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  mockRadioTextWrap: {
    flex: 1,
  },
  mockRadioLabel: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 14,
  },
  mockRadioLabelActive: {
    color: colors.primary,
  },
  mockRadioHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  mockTimeStepper: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    marginLeft: "auto" as const,
    backgroundColor: colors.white,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  mockStepperBtn: {
    width: 30,
    height: 30,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  mockStepperBtnDisabled: {
    opacity: 0.35,
  },
  mockStepperValue: {
    ...typography.label,
    color: colors.primary,
    minWidth: 46,
    textAlign: "center" as const,
    fontSize: 13,
  },
});
