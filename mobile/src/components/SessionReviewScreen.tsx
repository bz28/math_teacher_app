import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { GradientButton } from "./GradientButton";
import { MathText } from "./MathText";
import { getSession, respondToStep, type SessionData } from "../services/api";
import { useColors, spacing, radii, typography, shadows, type ColorPalette } from "../theme";

interface SessionReviewScreenProps {
  sessionId: string;
  onBack: () => void;
  onPracticeSimilar: (problem: string) => void | Promise<void>;
  onResume: (sessionId: string) => void;
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const colors = useColors();
  const progressStyles = useMemo(() => makeProgressStyles(colors), [colors]);
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  // scrollRef must be declared BEFORE any early returns below — otherwise
  // the hook count grows on the render that transitions from loading → data,
  // triggering a Rules-of-Hooks crash: "Rendered more hooks than during the
  // previous render." This is exactly what broke the History → review flow.
  const scrollRef = useRef<ScrollView>(null);

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
  const isAbandoned = session.status === "abandoned";
  const isActive = session.status === "active";

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <AnimatedPressable style={styles.backButton} onPress={onBack}>
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </AnimatedPressable>

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Problem header */}
        <View style={[styles.problemCard, shadows.md]}>
          <View style={styles.problemHeader}>
            <Ionicons
              name={isAbandoned ? "close-circle" : isCompleted ? "checkmark-circle" : "time-outline"}
              size={22}
              color={isAbandoned ? colors.error : isCompleted ? colors.success : colors.textMuted}
            />
            <Text style={styles.statusText}>
              {isAbandoned ? "Ended Early" : isCompleted ? "Completed" : "In Progress"}
            </Text>
          </View>
          <MathText text={session.problem} style={styles.problemText} />
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
                      <MathText text={step.description} style={styles.stepDescription} />
                      {step.final_answer ? (
                        <View style={styles.answerRow}>
                          <Ionicons name="arrow-forward" size={14} color={colors.primary} />
                          <MathText text={step.final_answer} style={styles.answerText} />
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

        {/* Chat — ask questions about this session */}
        {isCompleted && (
          <SessionChat sessionId={sessionId} scrollRef={scrollRef} />
        )}

        {/* Action buttons */}
        {isActive ? (
          <AnimatedPressable
            style={[styles.resumeButton, shadows.sm]}
            onPress={() => onResume(sessionId)}
            scaleDown={0.97}
          >
            <Ionicons name="play" size={18} color={colors.white} />
            <Text style={styles.actionButtonText}>Resume Session</Text>
          </AnimatedPressable>
        ) : (
          <AnimatedPressable
            style={[styles.practiceButton, shadows.sm, practiceLoading && { opacity: 0.7 }]}
            onPress={async () => {
              setPracticeLoading(true);
              try {
                await onPracticeSimilar(session.problem);
              } finally {
                setPracticeLoading(false);
              }
            }}
            scaleDown={0.97}
            disabled={practiceLoading}
          >
            {practiceLoading ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Ionicons name="refresh" size={18} color={colors.white} />
            )}
            <Text style={styles.actionButtonText}>
              {practiceLoading ? "Generating..." : "Practice Similar Problem"}
            </Text>
          </AnimatedPressable>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SessionChat({ sessionId, scrollRef }: { sessionId: string; scrollRef: React.RefObject<ScrollView | null> }) {
  const colors = useColors();
  const chatStyles = useMemo(() => makeChatStyles(colors), [colors]);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  const handleSend = async () => {
    const q = input.trim();
    if (!q || thinking) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setThinking(true);
    try {
      const response = await respondToStep(sessionId, q, false);
      setMessages((prev) => [...prev, { role: "assistant", text: response.feedback }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Something went wrong. Try again." }]);
    } finally {
      setThinking(false);
    }
  };

  return (
      <View style={chatStyles.container}>
        <Text style={chatStyles.title}>Have questions?</Text>

        {messages.map((msg, i) => (
          <View
            key={i}
            style={[
              chatStyles.bubble,
              msg.role === "user" ? chatStyles.userBubble : chatStyles.assistantBubble,
            ]}
          >
            {msg.role === "user" ? (
              <Text style={[chatStyles.bubbleText, chatStyles.userBubbleText]}>{msg.text}</Text>
            ) : (
              <MathText text={msg.text} style={chatStyles.bubbleText} />
            )}
          </View>
        ))}

        {thinking && (
          <View style={[chatStyles.bubble, chatStyles.assistantBubble]}>
            <Text style={[chatStyles.bubbleText, { color: colors.textMuted }]}>Thinking...</Text>
          </View>
        )}

        <View style={chatStyles.inputRow}>
          <TextInput
            style={chatStyles.input}
            placeholder="Ask about this problem..."
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSend}
            editable={!thinking}
            returnKeyType="send"
            onFocus={() => {
              setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
            }}
          />
          <GradientButton
            onPress={handleSend}
            label="Ask"
            loading={thinking}
            disabled={!input.trim()}
            style={chatStyles.sendButton}
          />
        </View>
      </View>
  );
}

const makeChatStyles = (colors: ColorPalette) => StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  bubble: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  userBubble: {
    backgroundColor: colors.primaryBg,
    marginLeft: spacing.xl,
    alignSelf: "flex-end" as const,
  },
  assistantBubble: {
    backgroundColor: colors.borderLight,
    marginRight: spacing.xl,
    alignSelf: "flex-start" as const,
  },
  bubbleText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  userBubbleText: {
    color: colors.primary,
  },
  inputRow: {
    flexDirection: "row" as const,
    gap: spacing.sm,
    alignItems: "center" as const,
  },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.white,
  },
  sendButton: {
    paddingHorizontal: spacing.md,
    minWidth: 60,
  },
});

const makeProgressStyles = (colors: ColorPalette) => StyleSheet.create({
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

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
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

  // End session
  endSessionButton: {
    alignItems: "center",
    paddingVertical: spacing.lg,
    marginTop: spacing.sm,
  },
  endSessionText: {
    ...typography.caption,
    color: colors.error,
    fontSize: 14,
  },
});
