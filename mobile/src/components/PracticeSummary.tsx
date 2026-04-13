import { useEffect, useMemo, useRef } from "react";
import {
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { ConfettiOverlay, type ConfettiOverlayRef } from "./ConfettiOverlay";
import { cleanMathPreview } from "./HistoryCards";
import { useSessionStore } from "../stores/session";
import { sessionStyles as styles } from "./sessionStyles";
import { useColors, spacing } from "../theme";

interface PracticeSummaryProps {
  onBack: () => void;
  onHome: () => void;
}

function formatTimeTaken(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function PracticeSummary({ onBack, onHome }: PracticeSummaryProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const confettiRef = useRef<ConfettiOverlayRef>(null);
  const {
    practiceBatch,
    togglePracticeFlag,
    startLearnQueue,
    reset,
  } = useSessionStore();

  if (!practiceBatch?.results) return null;

  const results = practiceBatch.results;
  const correct = results.filter((r) => r.isCorrect === true).length;
  const answered = results.filter((r) => r.userAnswer !== null).length;
  const unanswered = results.length - answered;
  const score = answered > 0 ? Math.round((correct / results.length) * 100) : 0;
  const timeTaken = practiceBatch.submittedAt && practiceBatch.startedAt
    ? Math.floor((practiceBatch.submittedAt - practiceBatch.startedAt) / 1000)
    : null;

  const encouragement =
    score === 100 ? "Perfect score!" :
    score >= 90 ? "Excellent work!" :
    score >= 70 ? "Good job!" :
    score >= 50 ? "Keep practicing!" :
    "Don't give up — review and try again!";

  const flaggedCount = practiceBatch.flags.filter(Boolean).length;
  const flaggedQuestions = results
    .map((r, i) => ({ question: r.question, index: i }))
    .filter((_, i) => practiceBatch.flags[i]);

  // Confetti on good score
  useEffect(() => {
    if (score === 100) confettiRef.current?.fire(true);
    else if (score >= 70) confettiRef.current?.fire(false);
  }, []);

  const handleBack = () => {
    reset();
    onBack();
  };

  return (
    <View style={styles.container}>
      {score >= 70 && <ConfettiOverlay ref={confettiRef} />}
      <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <AnimatedPressable onPress={handleBack} style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44 }} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </AnimatedPressable>
          <Text style={styles.title} accessibilityRole="header">Practice Complete</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Practice Results</Text>
          <Text style={styles.summaryScore} accessibilityLabel={`${correct} out of ${results.length} correct`}>
            {correct}/{results.length}
          </Text>
          <Text style={styles.summaryEncouragement}>{encouragement}</Text>
          <View style={styles.summaryBar}>
            <View
              style={[
                styles.summaryBarFill,
                { width: `${score}%` },
              ]}
            />
          </View>
          {timeTaken != null && (
            <Text style={styles.summaryTime}>Completed in {formatTimeTaken(timeTaken)}</Text>
          )}
          <View style={styles.summaryStats}>
            <View style={styles.statDot}>
              <View style={[styles.dot, { backgroundColor: colors.success }]} />
              <Text style={styles.statText}>{correct} correct</Text>
            </View>
            <View style={styles.statDot}>
              <View style={[styles.dot, { backgroundColor: colors.error }]} />
              <Text style={styles.statText}>{answered - correct} wrong</Text>
            </View>
            {unanswered > 0 && (
              <View style={styles.statDot}>
                <View style={[styles.dot, { backgroundColor: colors.textMuted }]} />
                <Text style={styles.statText}>{unanswered} skipped</Text>
              </View>
            )}
          </View>
        </View>

        {/* Question breakdown */}
        {results.map((r, i) => (
          <View
            key={i}
            style={[
              styles.resultRow,
              r.isCorrect === true ? styles.resultCorrect :
              r.isCorrect === false ? styles.resultWrong :
              styles.resultSkipped,
            ]}
          >
            <Ionicons
              name={r.isCorrect === true ? "checkmark-circle" : r.isCorrect === false ? "close-circle" : "remove-circle-outline"}
              size={20}
              color={r.isCorrect === true ? colors.success : r.isCorrect === false ? colors.error : colors.textMuted}
              style={{ marginRight: 10, marginTop: 1 }}
            />
            <View style={styles.resultContent}>
              <Text style={styles.resultProblem}>{cleanMathPreview(r.question)}</Text>
              {r.isCorrect === true && (
                <>
                  <Text style={styles.resultAnswer}>Your answer: {cleanMathPreview(r.userAnswer ?? "")}</Text>
                  <Text style={[styles.resultAnswer, { color: colors.success }]}>Correct!</Text>
                </>
              )}
              {r.isCorrect === false && (
                <>
                  <Text style={[styles.resultAnswer, { color: colors.error }]}>Your answer: {cleanMathPreview(r.userAnswer ?? "")}</Text>
                  <Text style={styles.resultHint}>Flag this question and learn it to see the answer</Text>
                </>
              )}
              {r.isCorrect == null && (
                <>
                  <Text style={styles.resultAnswer}>Unanswered</Text>
                  <Text style={styles.resultHint}>Flag this question and learn it to see the answer</Text>
                </>
              )}
            </View>
            <AnimatedPressable
              style={[styles.flagToggle, practiceBatch.flags[i] && styles.flagToggleActive]}
              onPress={() => togglePracticeFlag(i)}
            >
              <Text style={[styles.flagToggleText, practiceBatch.flags[i] && styles.flagToggleTextActive]}>
                {practiceBatch.flags[i] ? "Flagged" : "Flag"}
              </Text>
            </AnimatedPressable>
          </View>
        ))}

        {flaggedCount > 0 && (
          <AnimatedPressable
            style={styles.learnFlaggedButton}
            onPress={() => {
              const flagged = flaggedQuestions.map((q) => q.question);
              startLearnQueue(flagged);
            }}
          >
            <Text style={styles.learnFlaggedText}>
              Learn {flaggedCount} Flagged Problem{flaggedCount > 1 ? "s" : ""}
            </Text>
          </AnimatedPressable>
        )}

        <AnimatedPressable style={styles.newProblemButton} onPress={handleBack}>
          <Text style={styles.newProblemText}>New Problem</Text>
        </AnimatedPressable>

        <AnimatedPressable style={styles.homeButton} onPress={() => { reset(); onHome(); }}>
          <Ionicons name="home-outline" size={18} color={colors.primary} />
          <Text style={styles.homeButtonText}>Return Home</Text>
        </AnimatedPressable>
      </ScrollView>
    </View>
  );
}
