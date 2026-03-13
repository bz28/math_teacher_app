import { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { BackButton } from "./BackButton";
import { GradientButton } from "./GradientButton";
import { MathKeyboard } from "./MathKeyboard";
import { useSessionStore } from "../stores/session";
import { colors, spacing, radii, typography, shadows } from "../theme";

interface Props {
  onBack: () => void;
}

export function MockTestScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const {
    mockTest,
    saveMockTestAnswer,
    navigateMockQuestion,
    toggleMockTestFlag,
    submitMockTest,
    reset,
  } = useSessionStore();

  const [localAnswer, setLocalAnswer] = useState("");

  // Timer state
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  // Initialize timer
  useEffect(() => {
    if (!mockTest || mockTest.timeLimitSeconds == null) return;
    const elapsed = Math.floor((Date.now() - mockTest.startedAt) / 1000);
    setRemainingSeconds(Math.max(0, mockTest.timeLimitSeconds - elapsed));
  }, [mockTest?.startedAt, mockTest?.timeLimitSeconds]);

  // Countdown timer
  useEffect(() => {
    if (remainingSeconds == null || remainingSeconds <= 0) return;
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev == null || prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [remainingSeconds != null && remainingSeconds > 0]);

  // Auto-submit on time up
  useEffect(() => {
    if (remainingSeconds === 0 && mockTest && !mockTest.results) {
      // Save current answer before submitting
      if (localAnswer.trim()) {
        saveMockTestAnswer(mockTest.currentIndex, localAnswer.trim());
      }
      Alert.alert("Time's up!", "Submitting your answers.", [
        { text: "OK", onPress: () => submitMockTest() },
      ]);
    }
  }, [remainingSeconds]);

  if (!mockTest) return null;

  const { questions, answers, flags, currentIndex } = mockTest;
  const currentQuestion = questions[currentIndex];

  // Sync local answer when navigating
  useEffect(() => {
    setLocalAnswer(answers[currentIndex] ?? "");
  }, [currentIndex]);

  const handleNavigate = (index: number) => {
    // Save current answer before navigating
    if (localAnswer.trim()) {
      saveMockTestAnswer(currentIndex, localAnswer.trim());
    } else if (answers[currentIndex]) {
      // Clear answer if input was emptied
      saveMockTestAnswer(currentIndex, "");
    }
    navigateMockQuestion(index);
  };

  const handlePrev = () => {
    if (currentIndex > 0) handleNavigate(currentIndex - 1);
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) handleNavigate(currentIndex + 1);
  };

  const handleSubmit = () => {
    // Save current answer first
    if (localAnswer.trim()) {
      saveMockTestAnswer(currentIndex, localAnswer.trim());
    }

    // Count after saving current answer
    const latestAnswers = { ...answers, ...(localAnswer.trim() ? { [currentIndex]: localAnswer.trim() } : {}) };
    const answeredCount = questions.filter((_, i) => latestAnswers[i]?.trim()).length;
    const unansweredCount = questions.length - answeredCount;

    const message = unansweredCount > 0
      ? `You have ${unansweredCount} unanswered question${unansweredCount > 1 ? "s" : ""}. Submit anyway?`
      : "Ready to submit? You won't be able to change answers.";

    Alert.alert("Submit Exam", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Submit",
        style: "destructive",
        onPress: () => submitMockTest(),
      },
    ]);
  };

  const handleBack = () => {
    Alert.alert("Leave Exam?", "Progress will be lost.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () => { reset(); onBack(); },
      },
    ]);
  };

  const handleInsert = (value: string) => {
    setLocalAnswer((prev) => prev + value);
    inputRef.current?.focus();
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const isTimeLow = remainingSeconds != null && remainingSeconds <= 300 && remainingSeconds > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Sticky header */}
      <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <BackButton onPress={handleBack} />
          <View style={[styles.timerBadge, isTimeLow && styles.timerBadgeLow]}>
            <Ionicons
              name="time-outline"
              size={16}
              color={isTimeLow ? colors.error : colors.textSecondary}
            />
            <Text style={[styles.timerText, isTimeLow && styles.timerTextLow]}>
              {remainingSeconds != null ? formatTime(remainingSeconds) : "Untimed"}
            </Text>
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
          {questions.map((_, i) => {
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
          Question {currentIndex + 1} of {questions.length}
        </Text>

        {/* Question card */}
        <View style={[styles.questionCard, shadows.sm]}>
          <Text style={styles.questionText}>{currentQuestion.question}</Text>
        </View>

        {/* Answer input */}
        <View style={styles.answerSection}>
          <Text style={styles.answerLabel}>Your answer</Text>
          <TextInput
            ref={inputRef}
            style={styles.answerInput}
            value={localAnswer}
            onChangeText={setLocalAnswer}
            placeholder="Enter your answer..."
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            inputAccessoryViewID="math-mock-test"
          />
        </View>

        {/* Flag button */}
        <AnimatedPressable
          style={[styles.flagButton, flags[currentIndex] && styles.flagButtonActive]}
          onPress={() => {
            toggleMockTestFlag(currentIndex);
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
          <GradientButton
            onPress={handleNext}
            label="Next →"
            disabled={currentIndex === questions.length - 1}
            style={styles.navButton}
          />
        </View>
      </ScrollView>

      <MathKeyboard onInsert={handleInsert} accessoryID="math-mock-test" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
  timerBadgeLow: {
    backgroundColor: colors.errorLight,
  },
  timerText: {
    ...typography.bodyBold,
    color: colors.textSecondary,
    fontSize: 14,
  },
  timerTextLow: {
    color: colors.error,
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
  answerInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
    ...typography.body,
    backgroundColor: colors.inputBg,
    color: colors.text,
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
