import {
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { useSessionStore } from "../stores/session";
import { sessionStyles as styles } from "./sessionStyles";
import { colors, spacing } from "../theme";

interface PracticeSummaryProps {
  onBack: () => void;
}

export function PracticeSummary({ onBack }: PracticeSummaryProps) {
  const insets = useSafeAreaInsets();
  const {
    practiceBatch,
    togglePracticeFlag,
    retryFlaggedProblems,
    startLearnQueue,
    reset,
  } = useSessionStore();

  if (!practiceBatch) return null;

  const { results, flags, problems, skippedProblems } = practiceBatch;
  const correct = results.filter((r) => r.isCorrect).length;
  const pct = correct / results.length;
  const encouragement =
    pct === 1 ? "Perfect score!" :
    pct >= 0.8 ? "Great job!" :
    pct >= 0.5 ? "Good effort, keep practicing!" :
    "Don't give up — review and try again!";

  const flaggedCount = flags.filter(Boolean).length;

  const handleBack = () => {
    reset();
    onBack();
  };

  return (
    <View style={styles.container}>
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
          <Text style={styles.summaryTitle}>Results</Text>
          <Text style={styles.summaryScore} accessibilityLabel={`${correct} out of ${results.length} correct`}>
            {correct}/{results.length} correct
          </Text>
          <Text style={styles.summaryEncouragement}>{encouragement}</Text>
          <View style={styles.summaryBar}>
            <View
              style={[
                styles.summaryBarFill,
                { width: `${(correct / results.length) * 100}%` },
              ]}
            />
          </View>
        </View>

        {results.map((r, i) => (
          <View
            key={i}
            style={[
              styles.resultRow,
              r.isCorrect ? styles.resultCorrect : styles.resultWrong,
            ]}
          >
            <Ionicons
              name={r.isCorrect ? "checkmark-circle" : "close-circle"}
              size={20}
              color={r.isCorrect ? colors.success : colors.error}
              style={{ marginRight: 10, marginTop: 1 }}
            />
            <View style={styles.resultContent}>
              <Text style={styles.resultProblem}>{r.problem}</Text>
              <Text style={styles.resultAnswer}>
                Your answer: {r.userAnswer}
              </Text>
              {!r.isCorrect && (
                <Text style={styles.resultCorrectAnswer}>
                  Correct: {r.correctAnswer}
                </Text>
              )}
            </View>
            <AnimatedPressable
              style={[styles.flagToggle, flags[i] && styles.flagToggleActive]}
              onPress={() => togglePracticeFlag(i)}
            >
              <Text style={[styles.flagToggleText, flags[i] && styles.flagToggleTextActive]}>
                {flags[i] ? "Flagged" : "Flag"}
              </Text>
            </AnimatedPressable>
          </View>
        ))}

        {skippedProblems.length > 0 && (
          <View style={styles.skippedCard}>
            <View style={styles.skippedHeader}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.warningDark} />
              <Text style={styles.skippedTitle}>
                {skippedProblems.length} problem{skippedProblems.length > 1 ? "s" : ""} couldn't be processed
              </Text>
            </View>
            {skippedProblems.map((p, i) => (
              <Text key={i} style={styles.skippedProblem}>• {p}</Text>
            ))}
          </View>
        )}

        {flaggedCount > 0 && (
          <AnimatedPressable
            style={styles.retryButton}
            onPress={retryFlaggedProblems}
          >
            <Text style={styles.retryText}>
              Retry {flaggedCount} Flagged Problem{flaggedCount > 1 ? "s" : ""}
            </Text>
          </AnimatedPressable>
        )}

        {flaggedCount > 0 && (
          <AnimatedPressable
            style={styles.learnFlaggedButton}
            onPress={() => {
              const flagged = problems
                .filter((_, i) => flags[i])
                .map((p) => p.question);
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
      </ScrollView>
    </View>
  );
}
