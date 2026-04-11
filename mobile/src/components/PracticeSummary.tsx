import { useEffect, useRef } from "react";
import {
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { ConfettiOverlay, type ConfettiOverlayRef } from "./ConfettiOverlay";
import { DiagnosisTeaser } from "./DiagnosisTeaser";
import { cleanMathPreview } from "./HistoryCards";
import { completePracticeBatchSession } from "../services/api";
import { useSessionStore } from "../stores/session";
import { sessionStyles as styles } from "./sessionStyles";
import { useColors, spacing } from "../theme";

interface PracticeSummaryProps {
  onBack: () => void;
  onHome: () => void;
}

export function PracticeSummary({ onBack, onHome }: PracticeSummaryProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const confettiRef = useRef<ConfettiOverlayRef>(null);
  const {
    practiceBatch,
    togglePracticeFlag,
    retryFlaggedProblems,
    startLearnQueue,
    reset,
  } = useSessionStore();

  // Record practice batch in history
  useEffect(() => {
    if (!practiceBatch?.sessionId || practiceBatch.results.length === 0) return;
    const correct = practiceBatch.results.filter((r) => r.isCorrect).length;
    completePracticeBatchSession(
      practiceBatch.sessionId,
      practiceBatch.results.length,
      correct,
    ).catch(() => {}); // Silent fail — history is non-critical
  }, [practiceBatch?.sessionId, practiceBatch?.results.length]);

  // Confetti on perfect practice score
  const allCorrect = practiceBatch?.results.every((r) => r.isCorrect) ?? false;
  useEffect(() => {
    if (allCorrect) confettiRef.current?.fire(true);
  }, []);

  if (!practiceBatch) return null;

  const { results, flags, problems, skippedProblems, workSubmissions } = practiceBatch;
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
      {allCorrect && <ConfettiOverlay ref={confettiRef} />}
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

        {results.map((r, i) => {
          const wasCorrect = r.isCorrect;
          return (
            <View
              key={i}
              style={[
                styles.resultRow,
                wasCorrect ? styles.resultCorrect : styles.resultWrong,
              ]}
            >
              <Ionicons
                name={wasCorrect ? "checkmark-circle" : "close-circle"}
                size={20}
                color={wasCorrect ? colors.success : colors.error}
                style={{ marginRight: 10, marginTop: 1 }}
              />
              <View style={styles.resultContent}>
                <Text style={styles.resultProblem}>{cleanMathPreview(r.problem)}</Text>
                <Text style={styles.resultAnswer}>
                  {r.userAnswer === "(skipped)" ? "Skipped" : `Your answer: ${cleanMathPreview(r.userAnswer)}`}
                </Text>
                <DiagnosisTeaser diagnosis={workSubmissions[i]} />
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
          );
        })}

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

        {flaggedCount > 0 && (
          <AnimatedPressable
            style={styles.retryButton}
            onPress={retryFlaggedProblems}
          >
            <Text style={styles.retryText}>
              Practice {flaggedCount} Similar Problem{flaggedCount > 1 ? "s" : ""}
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
