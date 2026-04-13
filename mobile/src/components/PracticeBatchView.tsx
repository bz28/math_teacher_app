import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { BackButton } from "./BackButton";
import { GradientButton } from "./GradientButton";
import { MathText } from "./MathText";
import { useSessionStore } from "../stores/session";
import { useColors, spacing, radii, typography, shadows, type ColorPalette } from "../theme";
import { StyleSheet } from "react-native";

interface PracticeBatchViewProps {
  onBack: () => void;
}

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PracticeBatchView({ onBack }: PracticeBatchViewProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const {
    practiceBatch,
    savePracticeAnswer,
    setPracticeIndex,
    togglePracticeFlag,
    submitPractice,
    reset,
  } = useSessionStore();

  // Elapsed timer
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!practiceBatch) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - practiceBatch.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [practiceBatch?.startedAt]);

  if (!practiceBatch) return null;

  const { problems, answers, flags, currentIndex } = practiceBatch;
  const currentQuestion = problems[currentIndex];
  const currentAnswer = answers[currentIndex] ?? "";

  const handleNavigate = (index: number) => {
    setPracticeIndex(index);
  };

  const handlePrev = () => {
    if (currentIndex > 0) handleNavigate(currentIndex - 1);
  };

  const handleNext = () => {
    if (currentIndex < problems.length - 1) handleNavigate(currentIndex + 1);
  };

  const handleSubmit = () => {
    const answeredCount = problems.filter((_, i) => answers[i]?.trim()).length;
    const unansweredCount = problems.length - answeredCount;

    let message = "Ready to submit? You won't be able to change answers.";
    if (unansweredCount > 0) {
      message = `You have ${unansweredCount} unanswered question${unansweredCount > 1 ? "s" : ""}. Submit anyway?`;
    }

    Alert.alert("Submit Practice", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Submit",
        style: "destructive",
        onPress: () => submitPractice(),
      },
    ]);
  };

  const handleBack = () => {
    Alert.alert("Leave Practice?", "Progress will be lost.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () => { reset(); onBack(); },
      },
    ]);
  };

  // Build shuffled MCQ choices
  const choices = useMemo(() => {
    if (!currentQuestion?.answer || !currentQuestion.distractors?.length) return [];
    const all = [currentQuestion.answer, ...currentQuestion.distractors];
    const seed = currentIndex;
    return [...all].sort((a, b) => {
      const ha = Array.from(a).reduce((h, c) => (h * 31 + c.charCodeAt(0) + seed) | 0, 0);
      const hb = Array.from(b).reduce((h, c) => (h * 31 + c.charCodeAt(0) + seed) | 0, 0);
      return ha - hb;
    });
  }, [currentQuestion, currentIndex]);

  const letters = ["A", "B", "C", "D"];

  return (
    <View style={styles.container}>
      {/* Sticky header */}
      <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <BackButton onPress={handleBack} />
          <View style={styles.timerBadge}>
            <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.timerText}>{formatElapsed(elapsed)}</Text>
          </View>
          <AnimatedPressable style={styles.submitBtn} onPress={handleSubmit}>
            <Text style={styles.submitBtnText}>Submit</Text>
          </AnimatedPressable>
        </View>

        {/* Navigator pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsContainer}
        >
          {problems.map((_, i) => {
            const isAnswered = !!answers[i]?.trim();
            const isFlagged = flags[i];
            const isCurrent = i === currentIndex;

            return (
              <AnimatedPressable
                key={i}
                style={[
                  styles.pill,
                  isAnswered && styles.pillAnswered,
                  isCurrent && styles.pillCurrent,
                  isFlagged && styles.pillFlagged,
                ]}
                onPress={() => handleNavigate(i)}
                scaleDown={0.9}
              >
                <Text
                  style={[
                    styles.pillText,
                    isAnswered && styles.pillTextAnswered,
                    isCurrent && styles.pillTextCurrent,
                  ]}
                >
                  {i + 1}
                </Text>
              </AnimatedPressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Question header */}
        <Text style={styles.questionLabel}>
          Question {currentIndex + 1} of {problems.length}
        </Text>

        {/* Question card */}
        <View style={[styles.questionCard, shadows.sm]}>
          <MathText text={currentQuestion.question} style={styles.questionText} />
        </View>

        {/* MCQ choices */}
        <View style={styles.answerSection}>
          <Text style={styles.answerLabel}>Your answer</Text>
          {choices.length > 0 ? (
            <View style={styles.choicesGrid}>
              {choices.map((choice, i) => {
                const isSelected = currentAnswer === choice;
                return (
                  <AnimatedPressable
                    key={choice}
                    style={[styles.choiceButton, isSelected && styles.choiceButtonSelected]}
                    onPress={() => {
                      savePracticeAnswer(currentIndex, choice);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    scaleDown={0.97}
                    accessibilityRole="button"
                    accessibilityLabel={`Choice ${letters[i]}: ${choice}`}
                  >
                    <View style={[styles.choiceLetter, isSelected && styles.choiceLetterSelected]}>
                      <Text style={[styles.choiceLetterText, isSelected && styles.choiceLetterTextSelected]}>
                        {letters[i]}
                      </Text>
                    </View>
                    <MathText
                      text={choice}
                      style={{
                        ...styles.choiceText,
                        ...(isSelected ? styles.choiceTextSelected : {}),
                      }}
                    />
                  </AnimatedPressable>
                );
              })}
            </View>
          ) : (
            <View style={styles.choicesLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.choicesLoadingText}>Loading choices…</Text>
            </View>
          )}
        </View>

        {/* Flag button */}
        <AnimatedPressable
          style={[styles.flagButton, flags[currentIndex] && styles.flagButtonActive]}
          onPress={() => {
            togglePracticeFlag(currentIndex);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
        >
          <Ionicons
            name={flags[currentIndex] ? "flag" : "flag-outline"}
            size={18}
            color={flags[currentIndex] ? colors.warningDark : colors.textSecondary}
          />
          <Text style={[styles.flagText, flags[currentIndex] && styles.flagTextActive]}>
            {flags[currentIndex] ? "Flagged for review" : "Flag for review"}
          </Text>
        </AnimatedPressable>

        {/* Prev / Next buttons */}
        <View style={styles.navRow}>
          <GradientButton
            onPress={handlePrev}
            label="← Prev"
            disabled={currentIndex === 0}
            style={styles.navButton}
          />
          {currentIndex === problems.length - 1 ? (
            <GradientButton
              onPress={handleSubmit}
              label="✓ Submit"
              gradient="success"
              style={styles.navButton}
            />
          ) : (
            <GradientButton
              onPress={handleNext}
              label="Next →"
              style={styles.navButton}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  stickyHeader: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  timerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.inputBg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  timerText: {
    ...typography.bodyBold,
    color: colors.textSecondary,
    fontSize: 14,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
  },
  submitBtnText: {
    ...typography.label,
    color: colors.white,
  },
  pillsContainer: {
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  pill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.inputBg,
    borderWidth: 2,
    borderColor: "transparent",
  },
  pillAnswered: {
    backgroundColor: colors.primaryBg,
  },
  pillCurrent: {
    borderColor: colors.primary,
  },
  pillFlagged: {
    borderColor: colors.warningDark,
  },
  pillText: {
    ...typography.label,
    color: colors.textMuted,
  },
  pillTextAnswered: {
    color: colors.primary,
  },
  pillTextCurrent: {
    color: colors.primary,
    fontWeight: "700",
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  questionLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  questionCard: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.xl,
    marginBottom: spacing.xl,
  },
  questionText: {
    ...typography.body,
    color: colors.text,
    lineHeight: 26,
  },
  answerSection: {
    marginBottom: spacing.lg,
  },
  answerLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  choicesGrid: {
    gap: spacing.sm,
  },
  choiceButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderWidth: 1.5,
    borderColor: colors.borderLight,
    borderRadius: radii.md,
    padding: spacing.lg,
    backgroundColor: colors.white,
    gap: spacing.md,
  },
  choiceButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryBg,
  },
  choiceLetter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.inputBg,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  choiceLetterSelected: {
    backgroundColor: colors.primary,
  },
  choiceLetterText: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 13,
  },
  choiceLetterTextSelected: {
    color: colors.white,
  },
  choiceText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  choiceTextSelected: {
    color: colors.primary,
    fontWeight: "600" as const,
  },
  choicesLoading: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  choicesLoadingText: {
    ...typography.body,
    color: colors.textMuted,
  },
  flagButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginBottom: spacing.xl,
  },
  flagButtonActive: {
    borderColor: colors.warningDark,
    backgroundColor: colors.warningBg,
  },
  flagText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  flagTextActive: {
    color: colors.warningDark,
  },
  navRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  navButton: {
    flex: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: "center",
  },
});
