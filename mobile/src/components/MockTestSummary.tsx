import { useEffect, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { ConfettiOverlay, type ConfettiOverlayRef } from "./ConfettiOverlay";
import { DiagnosisTeaser } from "./DiagnosisTeaser";
import { GradientButton } from "./GradientButton";
import { cleanMathPreview } from "./HistoryCards";
import { useSessionStore } from "../stores/session";
import { useColors, spacing, radii, typography, shadows, type ColorPalette } from "../theme";

interface Props {
  onBack: () => void;
  onHome: () => void;
}

export function MockTestSummary({ onBack, onHome }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { mockTest, startLearnQueue, toggleMockTestFlag, reset } = useSessionStore();
  const confettiRef = useRef<ConfettiOverlayRef>(null);

  if (!mockTest || !mockTest.results) return null;

  const { questions, results, flags, workSubmissions, workImages } = mockTest;
  const answered = results.filter((r) => r.isCorrect != null);
  const correct = results.filter((r) => r.isCorrect === true);
  const unanswered = results.filter((r) => r.isCorrect == null);
  const score = answered.length > 0 ? Math.round((correct.length / questions.length) * 100) : 0;

  const timeTaken = mockTest.submittedAt && mockTest.startedAt
    ? Math.floor((mockTest.submittedAt - mockTest.startedAt) / 1000)
    : null;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const getMessage = () => {
    if (score >= 90) return "Excellent work!";
    if (score >= 70) return "Good job!";
    if (score >= 50) return "Keep practicing!";
    return "Don't give up — review and try again!";
  };

  const flaggedQuestions = questions
    .map((q, i) => ({ question: q.question, index: i }))
    .filter((_, i) => flags[i]);

  const handleLearnFlagged = async () => {
    if (flaggedQuestions.length === 0) return;
    await startLearnQueue(flaggedQuestions.map((q) => q.question));
  };

  // Confetti on good score (>=70%), intense at 100%
  useEffect(() => {
    if (score >= 70) confettiRef.current?.fire(score === 100);
  }, []);

  const handleNewExam = () => {
    reset();
    onBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      {score >= 70 && <ConfettiOverlay ref={confettiRef} />}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Score card */}
        <View style={[styles.scoreCard, shadows.md]}>
          <Text style={styles.scoreTitle}>Exam Results</Text>
          <Text style={styles.scoreValue}>{correct.length}/{questions.length}</Text>

          {/* Progress bar */}
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${score}%` }]} />
          </View>
          <Text style={styles.scorePercent}>{score}%</Text>

          <Text style={styles.scoreMessage}>{getMessage()}</Text>

          {timeTaken != null && (
            <View style={styles.timeRow}>
              <Ionicons name="time-outline" size={14} color={colors.textMuted} />
              <Text style={styles.timeText}>Completed in {formatTime(timeTaken)}</Text>
            </View>
          )}

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <View style={[styles.statDot, { backgroundColor: colors.success }]} />
              <Text style={styles.statText}>{correct.length} correct</Text>
            </View>
            <View style={styles.stat}>
              <View style={[styles.statDot, { backgroundColor: colors.error }]} />
              <Text style={styles.statText}>{answered.length - correct.length} wrong</Text>
            </View>
            <View style={styles.stat}>
              <View style={[styles.statDot, { backgroundColor: colors.textMuted }]} />
              <Text style={styles.statText}>{unanswered.length} skipped</Text>
            </View>
          </View>
        </View>

        {/* Per-question breakdown */}
        <Text style={styles.sectionTitle}>Question Breakdown</Text>
        {results.map((result, i) => {
          const isFlagged = flags[i];
          return (
            <View key={i} style={[styles.resultRow, shadows.sm]}>
              <View style={styles.resultHeader}>
                <View style={[
                  styles.resultIcon,
                  result.isCorrect === true && styles.resultIconCorrect,
                  result.isCorrect === false && styles.resultIconWrong,
                  result.isCorrect == null && styles.resultIconSkipped,
                ]}>
                  <Ionicons
                    name={
                      result.isCorrect === true ? "checkmark"
                      : result.isCorrect === false ? "close"
                      : "remove"
                    }
                    size={14}
                    color={
                      result.isCorrect === true ? colors.success
                      : result.isCorrect === false ? colors.error
                      : colors.textMuted
                    }
                  />
                </View>
                <Text style={styles.resultIndex}>Q{i + 1}</Text>
                <AnimatedPressable
                  style={[styles.flagToggle, isFlagged && styles.flagToggleActive]}
                  onPress={() => toggleMockTestFlag(i)}
                >
                  <Text style={[styles.flagToggleText, isFlagged && styles.flagToggleTextActive]}>
                    {isFlagged ? "Flagged" : "Flag"}
                  </Text>
                </AnimatedPressable>
              </View>
              <Text style={styles.resultQuestion} numberOfLines={2}>
                {cleanMathPreview(result.question)}
              </Text>
              <View style={styles.resultAnswers}>
                {result.isCorrect === true && (
                  <>
                    <Text style={styles.resultAnswer}>
                      Your answer: {cleanMathPreview(result.userAnswer ?? "")}
                    </Text>
                    <Text style={styles.resultCorrectAnswer}>
                      Correct!
                    </Text>
                  </>
                )}
                {result.isCorrect === false && (
                  <>
                    <Text style={[styles.resultAnswer, styles.resultAnswerWrong]}>
                      Your answer: {cleanMathPreview(result.userAnswer ?? "")}
                    </Text>
                    <Text style={styles.resultHint}>
                      Flag this question and learn it to see the answer
                    </Text>
                  </>
                )}
                {result.isCorrect == null && (
                  <>
                    <Text style={styles.resultSkipped}>Unanswered</Text>
                    <Text style={styles.resultHint}>
                      Flag this question and learn it to see the answer
                    </Text>
                  </>
                )}
              </View>
              <DiagnosisTeaser
                diagnosis={workSubmissions[i]}
                analyzing={workImages[i] != null}
              />
            </View>
          );
        })}

        {/* Flagged questions actions */}
        {flaggedQuestions.length > 0 && (
          <View style={styles.flaggedSection}>
            <Text style={styles.sectionTitle}>
              Flagged Questions ({flaggedQuestions.length})
            </Text>
            <GradientButton
              onPress={handleLearnFlagged}
              label="Learn These"
              style={styles.flaggedBtn}
            />
          </View>
        )}

        {/* New Exam button */}
        <AnimatedPressable style={styles.newExamBtn} onPress={handleNewExam}>
          <Ionicons name="refresh-outline" size={18} color={colors.primary} />
          <Text style={styles.newExamText}>New Exam</Text>
        </AnimatedPressable>

        {/* Return Home button */}
        <AnimatedPressable style={styles.newExamBtn} onPress={() => { reset(); onHome(); }}>
          <Ionicons name="home-outline" size={18} color={colors.primary} />
          <Text style={styles.newExamText}>Return Home</Text>
        </AnimatedPressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl * 2,
  },
  scoreCard: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.xxl,
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  scoreTitle: {
    ...typography.heading,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  scoreValue: {
    ...typography.hero,
    fontSize: 48,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  progressBg: {
    width: "100%",
    height: 8,
    backgroundColor: colors.inputBg,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  scorePercent: {
    ...typography.bodyBold,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  scoreMessage: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  timeText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.xl,
  },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  sectionTitle: {
    ...typography.bodyBold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  resultRow: {
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  resultIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  resultIconCorrect: {
    backgroundColor: colors.successLight,
  },
  resultIconWrong: {
    backgroundColor: colors.errorLight,
  },
  resultIconSkipped: {
    backgroundColor: colors.inputBg,
  },
  resultIndex: {
    ...typography.label,
    color: colors.textSecondary,
    flex: 1,
  },
  flagToggle: {
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    minHeight: 36,
    justifyContent: "center" as const,
  },
  flagToggleActive: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
  },
  flagToggleText: { ...typography.label, color: colors.textMuted },
  flagToggleTextActive: { color: colors.warningDark },
  resultQuestion: {
    ...typography.body,
    color: colors.text,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  resultAnswers: {
    gap: spacing.xs,
  },
  resultAnswer: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  resultAnswerWrong: {
    color: colors.error,
  },
  resultCorrectAnswer: {
    ...typography.caption,
    color: colors.success,
  },
  resultSkipped: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  resultHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  flaggedSection: {
    marginTop: spacing.xl,
  },
  flaggedBtn: {
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: "center",
  },
  newExamBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.xxl,
    paddingVertical: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radii.md,
  },
  newExamText: {
    ...typography.button,
    color: colors.primary,
  },
});
