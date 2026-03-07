import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSessionStore } from "../stores/session";
import { sessionStyles as styles } from "./sessionStyles";

interface LearnSummaryProps {
  onBack: () => void;
}

export function LearnSummary({ onBack }: LearnSummaryProps) {
  const insets = useSafeAreaInsets();
  const {
    learnQueue,
    toggleLearnFlag,
    practiceFlaggedFromLearnQueue,
    reset,
  } = useSessionStore();

  if (!learnQueue) return null;

  const flaggedCount = learnQueue.flags.filter(Boolean).length;

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
          <Text style={styles.title}>Learning Complete</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Problems Reviewed</Text>
          <Text style={styles.summaryScore}>{learnQueue.problems.length}</Text>
        </View>

        {learnQueue.problems.map((problem, i) => (
          <View key={i} style={[styles.resultRow, styles.resultCorrect]}>
            <Text style={styles.resultIcon}>{"\u2713"}</Text>
            <View style={styles.resultContent}>
              <Text style={styles.resultProblem}>{problem}</Text>
            </View>
            <TouchableOpacity
              style={[styles.flagToggle, learnQueue.flags[i] && styles.flagToggleActive]}
              onPress={() => toggleLearnFlag(i)}
            >
              <Text style={[styles.flagToggleText, learnQueue.flags[i] && styles.flagToggleTextActive]}>
                {learnQueue.flags[i] ? "Flagged" : "Flag"}
              </Text>
            </TouchableOpacity>
          </View>
        ))}

        {flaggedCount > 0 && (
          <TouchableOpacity
            style={styles.learnFlaggedButton}
            onPress={practiceFlaggedFromLearnQueue}
          >
            <Text style={styles.learnFlaggedText}>
              Practice {flaggedCount} Flagged Problem{flaggedCount > 1 ? "s" : ""}
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
