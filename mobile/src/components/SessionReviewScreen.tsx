import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { getSession, type SessionData } from "../services/api";
import { colors, spacing, radii, typography, shadows } from "../theme";

interface SessionReviewScreenProps {
  sessionId: string;
  onBack: () => void;
  onPracticeSimilar: (problem: string) => void;
}

export function SessionReviewScreen({ sessionId, onBack, onPracticeSimilar }: SessionReviewScreenProps) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await getSession(sessionId);
        setSession(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load session");
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} style={styles.centered} />
      </SafeAreaView>
    );
  }

  if (error || !session) {
    return (
      <SafeAreaView style={styles.container}>
        <AnimatedPressable style={styles.backButton} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </AnimatedPressable>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
          <Text style={styles.errorText}>{error ?? "Session not found"}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isCompleted = session.status === "completed";

  return (
    <SafeAreaView style={styles.container}>
      <AnimatedPressable style={styles.backButton} onPress={onBack}>
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </AnimatedPressable>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Problem header */}
        <View style={[styles.problemCard, shadows.md]}>
          <View style={styles.problemHeader}>
            <Ionicons
              name={isCompleted ? "checkmark-circle" : "time-outline"}
              size={22}
              color={isCompleted ? colors.success : colors.textMuted}
            />
            <Text style={styles.statusText}>
              {isCompleted ? "Completed" : "In Progress"}
            </Text>
          </View>
          <Text style={styles.problemText}>{session.problem}</Text>
          <Text style={styles.problemMeta}>
            {session.total_steps} step{session.total_steps !== 1 ? "s" : ""}
          </Text>
        </View>

        {/* Steps */}
        <Text style={styles.sectionLabel}>SOLUTION STEPS</Text>
        <View style={styles.stepsList}>
          {session.steps.map((step, i) => (
            <View key={i} style={[styles.stepCard, shadows.sm]}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{i + 1}</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepDescription}>{step.description}</Text>
                {step.final_answer ? (
                  <View style={styles.answerRow}>
                    <Ionicons name="arrow-forward" size={14} color={colors.primary} />
                    <Text style={styles.answerText}>{step.final_answer}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>

        {/* Practice similar button */}
        {isCompleted && (
          <AnimatedPressable
            style={[styles.practiceButton, shadows.sm]}
            onPress={() => onPracticeSimilar(session.problem)}
            scaleDown={0.97}
          >
            <Ionicons name="refresh" size={18} color={colors.white} />
            <Text style={styles.practiceButtonText}>Practice Similar Problem</Text>
          </AnimatedPressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xxl + 4,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  backButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    marginBottom: spacing.sm,
  },
  backText: { color: colors.primary, ...typography.bodyBold },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
  },

  // Problem card
  problemCard: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.xl,
    marginBottom: spacing.xxl,
  },
  problemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statusText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 13,
  },
  problemText: {
    ...typography.heading,
    color: colors.text,
    fontSize: 18,
    marginBottom: spacing.sm,
  },
  problemMeta: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },

  // Steps
  sectionLabel: {
    ...typography.small,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  stepsList: {
    gap: spacing.md,
  },
  stepCard: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.lg,
    gap: spacing.md,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryBg,
    justifyContent: "center",
    alignItems: "center",
  },
  stepNumberText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 13,
  },
  stepContent: {
    flex: 1,
  },
  stepDescription: {
    ...typography.body,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  answerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    backgroundColor: colors.primaryBg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
  },
  answerText: {
    ...typography.bodyBold,
    color: colors.primary,
    fontSize: 14,
    flex: 1,
  },

  // Practice button
  practiceButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
    marginTop: spacing.xxl,
  },
  practiceButtonText: {
    ...typography.button,
    color: colors.white,
  },
});
