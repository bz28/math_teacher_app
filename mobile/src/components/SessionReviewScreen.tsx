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
  onResume: (sessionId: string) => void;
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const progress = total > 0 ? current / total : 0;
  return (
    <View style={progressStyles.container}>
      <View style={progressStyles.track}>
        <View style={[progressStyles.fill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={progressStyles.label}>
        {current === total ? `${total} steps` : `Step ${current} of ${total}`}
      </Text>
    </View>
  );
}

export function SessionReviewScreen({ sessionId, onBack, onPracticeSimilar, onResume }: SessionReviewScreenProps) {
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
          <ProgressBar current={session.current_step} total={session.total_steps} />
        </View>

        {/* Steps */}
        <Text style={styles.sectionLabel}>SOLUTION STEPS</Text>
        <View style={styles.stepsList}>
          {session.steps.map((step, i) => {
            const isReached = i < session.current_step || isCompleted;
            return (
              <View
                key={i}
                style={[
                  styles.stepCard,
                  shadows.sm,
                  !isReached && styles.stepCardDimmed,
                ]}
              >
                <View style={[styles.stepNumber, !isReached && styles.stepNumberDimmed]}>
                  <Text style={[styles.stepNumberText, !isReached && styles.stepNumberTextDimmed]}>
                    {i + 1}
                  </Text>
                </View>
                <View style={styles.stepContent}>
                  {isReached ? (
                    <>
                      <Text style={styles.stepDescription}>{step.description}</Text>
                      {step.final_answer ? (
                        <View style={styles.answerRow}>
                          <Ionicons name="arrow-forward" size={14} color={colors.primary} />
                          <Text style={styles.answerText}>{step.final_answer}</Text>
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <Text style={styles.stepNotReached}>Not yet reached</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* Action button */}
        {isCompleted ? (
          <AnimatedPressable
            style={[styles.practiceButton, shadows.sm]}
            onPress={() => onPracticeSimilar(session.problem)}
            scaleDown={0.97}
          >
            <Ionicons name="refresh" size={18} color={colors.white} />
            <Text style={styles.actionButtonText}>Practice Similar Problem</Text>
          </AnimatedPressable>
        ) : (
          <AnimatedPressable
            style={[styles.resumeButton, shadows.sm]}
            onPress={() => onResume(sessionId)}
            scaleDown={0.97}
          >
            <Ionicons name="play" size={18} color={colors.white} />
            <Text style={styles.actionButtonText}>Resume Session</Text>
          </AnimatedPressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const progressStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  track: {
    flex: 1,
    height: 6,
    backgroundColor: colors.borderLight,
    borderRadius: 3,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
    minWidth: 80,
    textAlign: "right",
  },
});

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
  stepCardDimmed: {
    opacity: 0.45,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryBg,
    justifyContent: "center",
    alignItems: "center",
  },
  stepNumberDimmed: {
    backgroundColor: colors.borderLight,
  },
  stepNumberText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 13,
  },
  stepNumberTextDimmed: {
    color: colors.textMuted,
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
  stepNotReached: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
    fontStyle: "italic",
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

  // Action buttons
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
  resumeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.success,
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
    marginTop: spacing.xxl,
  },
  actionButtonText: {
    ...typography.button,
    color: colors.white,
  },
});
