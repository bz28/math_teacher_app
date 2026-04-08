import { useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { CompletedCard } from "./CompletedCard";
import { FeedbackCard } from "./FeedbackCard";
import { GradientButton } from "./GradientButton";
import { MathKeyboard } from "./MathKeyboard";
import { MockTestScreen } from "./MockTestScreen";
import { MockTestSummary } from "./MockTestSummary";
import { PracticeBatchView } from "./PracticeBatchView";
import { PracticeSummary } from "./PracticeSummary";
import { SessionSkeleton, PracticeSkeleton } from "./SkeletonLoader";
import { LearnSummary } from "./LearnSummary";
import { LoadingHero } from "./LoadingHero";
import { MathText } from "./MathText";
import { ConfettiOverlay, type ConfettiOverlayRef } from "./ConfettiOverlay";
import { PaywallScreen } from "./PaywallScreen";
import { UpgradePrompt } from "./UpgradePrompt";
import { useSessionStore } from "../stores/session";
import { useEntitlementStore } from "../stores/entitlements";
import { useUpgradePrompt } from "../hooks/useUpgradePrompt";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";
import { sessionScreenStyles as styles } from "./sessionScreenStyles";

interface SessionScreenProps {
  onBack: () => void;
  onHome: () => void;
}

export function SessionScreen({ onBack, onHome }: SessionScreenProps) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const confettiRef = useRef<ConfettiOverlayRef>(null);
  const [input, setInput] = useState("");
  const [askMode, setAskMode] = useState(false);

  const {
    session,
    phase,
    lastResponse,
    error,
    practiceBatch,
    mockTest,
    submitAnswer,
    advanceStep,
    askAboutStep,
    learnQueue,
    switchToLearnMode,
    finishAsking,
    problemImages,
    chatHistory,
    reset,
  } = useSessionStore();

  const isPro = useEntitlementStore((s) => s.isPro);
  const chatsRemaining = useEntitlementStore((s) => s.chatsRemaining);
  const dailyChatsLimit = useEntitlementStore((s) => s.dailyChatsLimit);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);
  const { show: showUpgrade, promptProps, paywallVisible: chatPaywallVisible, paywallTrigger, closePaywall } = useUpgradePrompt();

  const isBatchMode = !!practiceBatch;
  const isLearnQueue = !!learnQueue;
  const isCompleted = phase === "completed";
  const isPracticeSummary = phase === "practice_summary";
  const isLearnSummary = phase === "learn_summary";

  useEffect(() => {
    if (!lastResponse || lastResponse.action === "show_step") return;
    if (lastResponse.is_correct) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [lastResponse]);

  // Auto-scroll to bottom when new response arrives or phase changes
  useEffect(() => {
    if (lastResponse || phase === "awaiting_input") {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    }
  }, [lastResponse, phase]);

  // Scroll to bottom when chat history grows (so the latest bubble is visible)
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [chatHistory[session?.current_step ?? -1]?.length]);

  // Scroll when the keyboard appears in ask mode
  useEffect(() => {
    if (!askMode) return;
    const sub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => {
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      },
    );
    return () => sub.remove();
  }, [askMode]);

  // Confetti on learn completion
  useEffect(() => {
    if (phase === "completed") confettiRef.current?.fire();
  }, [phase]);

  // Loading state — full-screen subject-themed hero with pulsing icon
  if (phase === "loading") {
    const isGrading = isBatchMode && practiceBatch.pendingChecks > 0
      && practiceBatch.results.length >= practiceBatch.problems.length;
    if (isGrading) {
      return (
        <SafeAreaView style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.gradingText}>Grading your answers...</Text>
        </SafeAreaView>
      );
    }
    const subjectFromStore = useSessionStore.getState().subject;
    return <LoadingHero subject={subjectFromStore} mode={mockTest ? "test" : "learn"} />;
  }

  // Mock test mode
  if (mockTest) {
    if (phase === "mock_test_summary") return <MockTestSummary onBack={onBack} onHome={onHome} />;
    return <MockTestScreen onBack={onBack} />;
  }

  // Practice batch mode
  if (isBatchMode) {
    if (isPracticeSummary) return <PracticeSummary onBack={onBack} onHome={onHome} />;
    return <PracticeBatchView onBack={onBack} />;
  }

  // Learn summary screen
  if (isLearnSummary && learnQueue) {
    return <LearnSummary onBack={onBack} onHome={onHome} />;
  }

  if (!session) return null;

  const currentStep = session.steps[session.current_step];
  const isPractice = session.mode === "practice";
  const isLearn = !isPractice;
  const completedSteps = session.steps.slice(0, session.current_step);

  const handleSubmit = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    await submitAnswer(text);
  };

  const handleAsk = async () => {
    if (!input.trim()) return;
    if (!isPro && chatsRemaining() <= 0) {
      showUpgrade("chat_message", "Chat Limit Reached", `You've used all ${dailyChatsLimit} chat messages for today. Upgrade to Pro for unlimited chat.`);
      return;
    }
    const text = input.trim();
    setInput("");
    await askAboutStep(text);
    fetchEntitlements();
  };

  const handleInsert = (value: string) => {
    setInput((prev) => prev + value);
    inputRef.current?.focus();
  };

  const handleBack = () => {
    reset();
    onBack();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[readerStyles.slimHeader, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity
          onPress={handleBack}
          style={readerStyles.backIconBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={readerStyles.problemPill}>
          <MathText
            text={session.problem}
            style={readerStyles.problemPillText}
            numberOfLines={1}
          />
          {problemImages[session.problem] && (
            <Ionicons name="image" size={14} color={colors.textMuted} />
          )}
        </View>
        {isLearn && (
          <View style={readerStyles.dotsRow}>
            {Array.from({ length: session.total_steps }).map((_, i) => (
              <View
                key={i}
                style={[
                  readerStyles.dot,
                  i < session.current_step && readerStyles.dotDone,
                  i === session.current_step && readerStyles.dotCurrent,
                ]}
              />
            ))}
          </View>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Completed steps — tap to expand */}
        {isLearn && completedSteps.length > 0 && (
          <View style={compactStyles.historyContainer}>
            {completedSteps.map((step, i) => (
              <CompletedStepRow key={`step-${i}`} index={i} title={step.title} description={step.description} isLast={i === completedSteps.length - 1} />
            ))}
          </View>
        )}

        {/* Learn mode: show current step */}
        {isLearn && !isCompleted && currentStep && (
          <View style={[styles.stepDescCard, shadows.sm]}>
            <Text style={styles.stepDescLabel}>
              Step {session.current_step + 1}{currentStep.title ? ` — ${currentStep.title}` : ""}
            </Text>
            <MathText text={currentStep.description} style={styles.stepDescText} />
          </View>
        )}

        {/* iMessage-style chat thread above the current step (Learn mode) */}
        {isLearn && !isCompleted && (chatHistory[session.current_step]?.length ?? 0) > 0 && (
          <View style={chatStyles.thread}>
            {(chatHistory[session.current_step] ?? []).map((msg, i) => (
              <View
                key={`chat-${session.current_step}-${i}`}
                style={[
                  chatStyles.bubbleRow,
                  msg.role === "user" ? chatStyles.bubbleRowUser : chatStyles.bubbleRowTutor,
                ]}
              >
                {msg.role === "user" ? (
                  <View style={chatStyles.bubbleUser}>
                    <Text style={chatStyles.bubbleUserText}>{msg.text}</Text>
                  </View>
                ) : (
                  <View style={chatStyles.bubbleTutor}>
                    <MathText text={msg.text} style={chatStyles.bubbleTutorText} />
                  </View>
                )}
              </View>
            ))}
            {phase === "thinking" && (
              <View style={[chatStyles.bubbleRow, chatStyles.bubbleRowTutor]}>
                <View style={chatStyles.bubbleTutor}>
                  <Text style={chatStyles.bubbleTutorText}>Thinking…</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Practice mode: prompt */}
        {isPractice && !isCompleted && (
          <Text style={styles.promptText}>Enter your final answer</Text>
        )}

        {/* Thinking indicator */}
        {phase === "thinking" && (
          <View style={[compactStyles.thinkingCard, shadows.sm]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={compactStyles.thinkingText}>Thinking...</Text>
          </View>
        )}

        {/* Feedback */}
        {/* FeedbackCard for practice-mode answer feedback only.
            Learn-mode chat replies render as tutor bubbles in the chat
            thread above the step — showing the FeedbackCard for them too
            would duplicate the most recent reply. */}
        {isPractice && lastResponse && phase !== "thinking" && (
          <FeedbackCard response={lastResponse} />
        )}

        {/* Switch to Learn Mode (practice, wrong answer) */}
        {isPractice && lastResponse && !lastResponse.is_correct && !isCompleted && (
          <AnimatedPressable onPress={switchToLearnMode}>
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.switchModeButton}
            >
              <Ionicons name="book-outline" size={18} color={colors.white} style={{ marginRight: spacing.sm }} />
              <Text style={styles.switchModeText}>Switch to Learn Mode</Text>
            </LinearGradient>
          </AnimatedPressable>
        )}

        {error && (
          <View style={styles.errorWrap}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={styles.error}>{error}</Text>
          </View>
        )}

        {/* Completed */}
        {isCompleted && <CompletedCard onBack={onBack} onHome={onHome} />}

        {/* Practice mode: answer input stays in scroll body */}
        {!isCompleted && session.status !== "completed" && isPractice && (
          <>
            <View>
              <Text style={styles.inputLabel}>Your answer</Text>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="Enter your answer..."
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
                inputAccessoryViewID="math-session"
              />
            </View>
            <View style={styles.buttons}>
              <GradientButton
                onPress={handleSubmit}
                label="Answer"
                loading={phase === "thinking"}
                disabled={!input.trim()}
                style={styles.submitButton}
              />
            </View>
          </>
        )}
      </ScrollView>

      {/* Sticky bottom action area for Learn mode */}
      {isLearn && !isCompleted && (
        <View style={readerStyles.actionBar}>
          {askMode ? (
            <View style={readerStyles.askInputRow}>
              <TextInput
                ref={inputRef}
                style={readerStyles.askInput}
                value={input}
                onChangeText={setInput}
                placeholder="Ask about this step…"
                placeholderTextColor={colors.textMuted}
                autoFocus
                returnKeyType="send"
                blurOnSubmit={false}
                onSubmitEditing={async () => {
                  if (!input.trim()) {
                    Keyboard.dismiss();
                    setAskMode(false);
                    return;
                  }
                  Keyboard.dismiss();
                  await handleAsk();
                }}
                accessibilityLabel="Ask a question"
              />
              <TouchableOpacity
                onPress={() => { Keyboard.dismiss(); setAskMode(false); setInput(""); }}
                style={readerStyles.askCancelBtn}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  if (!input.trim()) return;
                  Keyboard.dismiss();
                  await handleAsk();
                }}
                style={readerStyles.askSend}
                disabled={!input.trim() || phase === "thinking"}
                accessibilityRole="button"
                accessibilityLabel="Send question"
              >
                <Ionicons name="arrow-up" size={20} color={colors.white} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={readerStyles.actionRow}>
              <TouchableOpacity
                onPress={session.status === "completed" ? finishAsking : advanceStep}
                style={readerStyles.primaryAction}
                disabled={phase === "thinking"}
                accessibilityRole="button"
                accessibilityLabel={session.status === "completed" ? "I understand now" : "I get it, next step"}
              >
                <LinearGradient
                  colors={gradients.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={readerStyles.primaryActionInner}
                >
                  <Text style={readerStyles.primaryActionText}>
                    {phase === "thinking" ? "…" : session.status === "completed" ? "I understand" : "I get it"}
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color={colors.white} />
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setAskMode(true)}
                style={readerStyles.secondaryAction}
                accessibilityRole="button"
                accessibilityLabel="Ask about this step"
              >
                <Ionicons name="help-circle-outline" size={20} color={colors.primary} />
                <Text style={readerStyles.secondaryActionText}>Ask</Text>
              </TouchableOpacity>
            </View>
          )}
          {!isPro && chatsRemaining() < Infinity && askMode && (
            <Text style={readerStyles.askChatHint}>{chatsRemaining()} chats left today</Text>
          )}
        </View>
      )}

      {!isLearn && <MathKeyboard onInsert={handleInsert} accessoryID="math-session" />}
      {phase === "completed" && <ConfettiOverlay ref={confettiRef} />}
      <UpgradePrompt {...promptProps} />
      <PaywallScreen
        visible={chatPaywallVisible}
        onClose={closePaywall}
        onPurchaseComplete={() => { closePaywall(); fetchEntitlements(); }}
        trigger={paywallTrigger}
      />
    </KeyboardAvoidingView>
  );
}

function CompletedStepRow({ index, title, description, isLast }: { index: number; title?: string; description: string; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <TouchableOpacity
      style={compactStyles.historyItem}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.6}
    >
      <View style={compactStyles.historyDotCol}>
        <View style={compactStyles.historyDot}>
          <Ionicons name="checkmark" size={10} color={colors.white} />
        </View>
        {!isLast && <View style={compactStyles.historyLine} />}
      </View>
      <View style={compactStyles.historyTextWrap}>
        <Text style={compactStyles.historyLabel}>
          Step {index + 1}{title ? ` — ${title}` : ""}
        </Text>
        <MathText
          text={description}
          style={compactStyles.historyText}
          numberOfLines={expanded ? undefined : 1}
        />
      </View>
      <Ionicons
        name={expanded ? "chevron-up" : "chevron-down"}
        size={14}
        color={colors.textMuted}
      />
    </TouchableOpacity>
  );
}

const readerStyles = StyleSheet.create({
  // Slim header
  slimHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.background,
  },
  backIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  problemPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.primaryBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  problemPillText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 12,
    flex: 1,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.borderLight,
  },
  dotDone: {
    backgroundColor: colors.success,
  },
  dotCurrent: {
    backgroundColor: colors.primary,
    width: 12,
  },

  // Sticky bottom action bar
  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.white,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  primaryAction: {
    flex: 2,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  primaryActionInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  primaryActionText: {
    ...typography.button,
    color: colors.white,
  },
  secondaryAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.primaryBg,
    borderRadius: radii.md,
    paddingVertical: spacing.lg,
  },
  secondaryActionText: {
    ...typography.button,
    color: colors.primary,
    fontSize: 14,
  },

  // Compose row stuck inline in the action bar (replaces the 2-button row when askMode)
  askInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.inputBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
    height: 48,
  },
  askInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "400",
    color: colors.text,
    paddingVertical: 0,
    paddingHorizontal: spacing.xs,
    height: 40,
    lineHeight: 20,
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  askCancelBtn: {
    padding: spacing.xs,
  },
  askSend: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  askChatHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xs,
  },
});

// In-body iMessage-style chat thread that renders ABOVE the current step card
const chatStyles = StyleSheet.create({
  thread: {
    marginBottom: spacing.md,
    gap: 6,
  },
  bubbleRow: {
    flexDirection: "row",
  },
  bubbleRowUser: {
    justifyContent: "flex-end",
    paddingLeft: 60,
  },
  bubbleRowTutor: {
    justifyContent: "flex-start",
    paddingRight: 60,
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleUserText: {
    ...typography.body,
    fontSize: 14,
    color: colors.white,
  },
  bubbleTutor: {
    backgroundColor: colors.white,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleTutorText: {
    ...typography.body,
    fontSize: 14,
    color: colors.text,
  },
});

const compactStyles = StyleSheet.create({
  historyContainer: {
    marginBottom: spacing.md,
  },
  historyItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingBottom: spacing.sm,
  },
  historyDotCol: {
    alignItems: "center",
    marginRight: spacing.md,
  },
  historyDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.success,
    justifyContent: "center",
    alignItems: "center",
  },
  historyLine: {
    width: 2,
    flex: 1,
    minHeight: 8,
    backgroundColor: colors.successBorder,
    marginTop: 2,
  },
  historyTextWrap: {
    flex: 1,
    paddingTop: 1,
  },
  historyLabel: {
    ...typography.small,
    color: colors.success,
    marginBottom: 2,
  },
  historyText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  questionBubble: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    alignSelf: "flex-end",
    backgroundColor: colors.primaryBg,
    borderRadius: radii.lg,
    borderBottomRightRadius: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    maxWidth: "85%",
  },
  questionText: {
    ...typography.body,
    color: colors.primary,
    fontSize: 14,
    flex: 1,
  },
  thinkingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  thinkingText: {
    ...typography.bodyBold,
    color: colors.textMuted,
    fontSize: 14,
  },
});
