import { Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { useSessionStore } from "../stores/session";
import { colors, spacing, shadows, gradients } from "../theme";
import { sessionScreenStyles as styles } from "./sessionScreenStyles";

interface CompletedCardProps {
  onBack: () => void;
  onHome: () => void;
}

export function CompletedCard({ onBack, onHome }: CompletedCardProps) {
  const {
    session,
    learnQueue,
    continueAsking,
    toggleLearnFlag,
    advanceLearnQueue,
    tryPracticeProblem,
    reset,
  } = useSessionStore();

  if (!session) return null;

  const isPractice = session.mode === "practice";
  const isLearn = !isPractice;
  const isLearnQueue = !!learnQueue;

  const handleBack = () => {
    reset();
    onBack();
  };

  const handleHome = () => {
    reset();
    onHome();
  };

  // Learn queue completion
  if (isLearnQueue && learnQueue) {
    return (
      <View style={[styles.completedCard, shadows.md]}>
        <View style={styles.completedIconWrap}>
          <Ionicons name="checkmark-circle" size={48} color={colors.success} />
        </View>
        <Text style={styles.completedTitle}>Problem Solved!</Text>

        <AnimatedPressable
          style={styles.questionsButton}
          onPress={continueAsking}
        >
          <Ionicons name="chatbubble-outline" size={16} color={colors.warningDark} style={{ marginRight: spacing.sm }} />
          <Text style={styles.questionsText}>I still have questions</Text>
        </AnimatedPressable>

        <AnimatedPressable
          style={[styles.flagButtonWide, learnQueue.flags[learnQueue.currentIndex] && styles.flagButtonActive]}
          onPress={() => toggleLearnFlag(learnQueue.currentIndex)}
        >
          <Ionicons
            name={learnQueue.flags[learnQueue.currentIndex] ? "flag" : "flag-outline"}
            size={16}
            color={learnQueue.flags[learnQueue.currentIndex] ? colors.warningDark : colors.textMuted}
            style={{ marginRight: spacing.sm }}
          />
          <Text style={[styles.flagText, learnQueue.flags[learnQueue.currentIndex] && styles.flagTextActive]}>
            {learnQueue.flags[learnQueue.currentIndex] ? "Flagged" : "Flag for Practice"}
          </Text>
        </AnimatedPressable>

        <AnimatedPressable
          style={styles.outlineButton}
          onPress={advanceLearnQueue}
        >
          <Text style={styles.outlineButtonText}>
            {learnQueue.currentIndex < learnQueue.problems.length - 1
              ? "Next Problem"
              : "View Results"}
          </Text>
          <Ionicons name="arrow-forward" size={16} color={colors.primary} style={{ marginLeft: spacing.sm }} />
        </AnimatedPressable>
      </View>
    );
  }

  // Non-queue completion
  return (
    <View style={[styles.completedCard, shadows.md]}>
      <View style={styles.completedIconWrap}>
        <Ionicons name="checkmark-circle" size={48} color={colors.success} />
      </View>
      <Text style={styles.completedTitle}>Problem Solved!</Text>
      {isLearn && (
        <AnimatedPressable onPress={tryPracticeProblem}>
          <LinearGradient
            colors={gradients.success}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.similarButton}
          >
            <Text style={styles.similarText}>Try a practice problem</Text>
          </LinearGradient>
        </AnimatedPressable>
      )}
      {isLearn && (
        <AnimatedPressable
          style={styles.questionsButton}
          onPress={continueAsking}
        >
          <Ionicons name="chatbubble-outline" size={16} color={colors.warningDark} style={{ marginRight: spacing.sm }} />
          <Text style={styles.questionsText}>I still have questions</Text>
        </AnimatedPressable>
      )}
      {isPractice && (
        <AnimatedPressable onPress={tryPracticeProblem}>
          <LinearGradient
            colors={gradients.success}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.similarButton}
          >
            <Text style={styles.similarText}>Try a similar problem</Text>
          </LinearGradient>
        </AnimatedPressable>
      )}
      <AnimatedPressable
        style={styles.outlineButton}
        onPress={handleBack}
      >
        <Text style={styles.outlineButtonText}>{isLearn ? "Learn New Problem" : "New Problem"}</Text>
      </AnimatedPressable>
      <AnimatedPressable
        style={styles.outlineButton}
        onPress={handleHome}
      >
        <Ionicons name="home-outline" size={16} color={colors.primary} style={{ marginRight: spacing.sm }} />
        <Text style={styles.outlineButtonText}>Return Home</Text>
      </AnimatedPressable>
    </View>
  );
}
