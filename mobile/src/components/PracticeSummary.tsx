import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSessionStore } from "../stores/session";
import { sessionStyles as styles } from "./sessionStyles";

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

  const { results, flags, problems } = practiceBatch;
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
          <TouchableOpacity onPress={handleBack}>
            <Text style={styles.backText}>{"\u2039 Back"}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Practice Complete</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Results</Text>
          <Text style={styles.summaryScore}>
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
            <Text style={styles.resultIcon}>
              {r.isCorrect ? "\u2713" : "\u2717"}
            </Text>
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
            <TouchableOpacity
              style={[styles.flagToggle, flags[i] && styles.flagToggleActive]}
              onPress={() => togglePracticeFlag(i)}
            >
              <Text style={[styles.flagToggleText, flags[i] && styles.flagToggleTextActive]}>
                {flags[i] ? "Flagged" : "Flag"}
              </Text>
            </TouchableOpacity>
          </View>
        ))}

        {flaggedCount > 0 && (
          <TouchableOpacity
            style={styles.retryButton}
            onPress={retryFlaggedProblems}
          >
            <Text style={styles.retryText}>
              Retry {flaggedCount} Flagged Problem{flaggedCount > 1 ? "s" : ""}
            </Text>
          </TouchableOpacity>
        )}

        {flaggedCount > 0 && (
          <TouchableOpacity
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
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.newProblemButton} onPress={handleBack}>
          <Text style={styles.newProblemText}>New Problem</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
