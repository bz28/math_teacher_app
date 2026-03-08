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
          <AnimatedPressable onPress={handleBack} style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44 }}>
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </AnimatedPressable>
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
            <Ionicons name="checkmark-circle" size={20} color={colors.success} style={{ marginRight: 10, marginTop: 1 }} />
            <View style={styles.resultContent}>
              <Text style={styles.resultProblem}>{problem}</Text>
            </View>
            <AnimatedPressable
              style={[styles.flagToggle, learnQueue.flags[i] && styles.flagToggleActive]}
              onPress={() => toggleLearnFlag(i)}
            >
              <Text style={[styles.flagToggleText, learnQueue.flags[i] && styles.flagToggleTextActive]}>
                {learnQueue.flags[i] ? "Flagged" : "Flag"}
              </Text>
            </AnimatedPressable>
          </View>
        ))}

        {flaggedCount > 0 && (
          <AnimatedPressable
            style={styles.learnFlaggedButton}
            onPress={practiceFlaggedFromLearnQueue}
          >
            <Text style={styles.learnFlaggedText}>
              Practice {flaggedCount} Flagged Problem{flaggedCount > 1 ? "s" : ""}
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
