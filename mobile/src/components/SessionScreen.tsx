import { useEffect, useMemo, useRef, useState } from "react";
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
import { CompletedCard } from "./CompletedCard";
import { MockTestScreen } from "./MockTestScreen";
import { MockTestSummary } from "./MockTestSummary";
import { PracticeBatchView } from "./PracticeBatchView";
import { PracticeSummary } from "./PracticeSummary";
import { SessionSkeleton, PracticeSkeleton } from "./SkeletonLoader";
import { LearnSummary } from "./LearnSummary";
import { LoadingHero } from "./LoadingHero";
import { MathText } from "./MathText";
import { cleanMathPreview } from "./HistoryCards";
import { ConfettiOverlay, type ConfettiOverlayRef } from "./ConfettiOverlay";
import { PaywallScreen } from "./PaywallScreen";
import { UpgradePrompt } from "./UpgradePrompt";
import { EntitlementError } from "../services/api";
import { useSessionStore } from "../stores/session";
import { useEntitlementStore } from "../stores/entitlements";
import { useUpgradePrompt } from "../hooks/useUpgradePrompt";
import { useColors, spacing, radii, typography, shadows, gradients, type ColorPalette } from "../theme";
import { makeSessionScreenStyles } from "./sessionScreenStyles";

interface SessionScreenProps {
  onBack: () => void;
  onHome: () => void;
}

export function SessionScreen({ onBack, onHome }: SessionScreenProps) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeSessionScreenStyles(colors), [colors]);
  const readerStyles = useMemo(() => makeReaderStyles(colors), [colors]);
  const chatStyles = useMemo(() => makeChatStyles(colors), [colors]);
  const compactStyles = useMemo(() => makeCompactStyles(colors), [colors]);
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
    advanceStep,
    askAboutStep,
    learnQueue,
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

  // Auto-scroll: consolidated trigger for every state change that should
  // re-anchor the scroll view at the bottom. Covers:
  //   - new tutor response or phase becoming awaiting_input
  //   - chat history growing for the current step (user msg, thinking, reply)
  //   - askMode thinking/awaiting_input transitions where chat length
  //     didn't change (placeholder bubble mount/unmount)
  // Two scrolls per trigger — the first catches the new bubble mount, the
  // second lands after layout settles in case the bubble grew taller than
  // the initial measurement. Both timer IDs are tracked in a ref and
  // cleared on re-run / unmount so we never leak stray timers.
  const stepChatLen = chatHistory[session?.current_step ?? -1]?.length ?? 0;
  useEffect(() => {
    const shouldScroll =
      !!lastResponse ||
      phase === "awaiting_input" ||
      stepChatLen > 0 ||
      (askMode && phase === "thinking");
    if (!shouldScroll) return;
    const scrollToEnd = () => scrollRef.current?.scrollToEnd({ animated: true });
    const t1 = setTimeout(scrollToEnd, 80);
    const t2 = setTimeout(scrollToEnd, 300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [lastResponse, phase, stepChatLen, askMode]);

  // Scroll when the keyboard appears in ask mode. Kept separate because
  // this fires on an OS event, not a state transition, and the listener
  // is torn down when askMode flips off.
  useEffect(() => {
    if (!askMode) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => {
        timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      },
    );
    return () => {
      sub.remove();
      if (timer) clearTimeout(timer);
    };
  }, [askMode]);

  // Confetti on learn completion
  useEffect(() => {
    if (phase === "completed") confettiRef.current?.fire();
  }, [phase]);

  // Loading state — full-screen subject-themed hero with pulsing icon
  if (phase === "loading") {
    // Mock test grading: mockTest exists and has answered questions (answers
    // object is non-empty). During initial test generation answers is empty;
    // during grading the user has already filled in answers and hit Submit.
    const isMockGrading = !!mockTest && Object.keys(mockTest.answers).length > 0;
    if (isMockGrading) {
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
  const completedSteps = session.steps.slice(0, session.current_step);

  const handleAsk = async () => {
    if (!input.trim()) return;
    if (!isPro && chatsRemaining() <= 0) {
      showUpgrade("chat_message", "Chat Limit Reached", `You've used all ${dailyChatsLimit} chat messages for today. Upgrade to Pro for unlimited chat.`);
      return;
    }
    const text = input.trim();
    setInput("");
    try {
      await askAboutStep(text);
    } catch (e) {
      if (e instanceof EntitlementError) { showUpgrade(e.entitlement, "Chat Limit Reached", e.message); return; }
    }
    fetchEntitlements();
  };

  const handleAdvance = async () => {
    try {
      await advanceStep();
    } catch (e) {
      if (e instanceof EntitlementError) showUpgrade(e.entitlement, "Daily Limit Reached", e.message);
    }
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
        {(
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
        {completedSteps.length > 0 && (
          <View style={compactStyles.historyContainer}>
            {completedSteps.map((step, i) => (
              <CompletedStepRow key={`step-${i}`} index={i} title={step.title} description={step.description} isLast={i === completedSteps.length - 1} />
            ))}
          </View>
        )}

        {/* Learn mode: show current step */}
        {!isCompleted && currentStep && (
          <View style={[styles.stepDescCard, shadows.sm]}>
            <Text style={styles.stepDescLabel}>
              Step {session.current_step + 1}{currentStep.title ? ` — ${currentStep.title}` : ""}
            </Text>
            <MathText text={currentStep.description} style={styles.stepDescText} />
          </View>
        )}

        {/* iMessage-style chat thread above the current step (Learn mode) */}
        {!isCompleted && (chatHistory[session.current_step]?.length ?? 0) > 0 && (
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
                    <Text style={chatStyles.bubbleTutorText}>{cleanMathPreview(msg.text)}</Text>
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

        {error && (
          <View style={styles.errorWrap}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={styles.error}>{error}</Text>
          </View>
        )}

        {/* Completed */}
        {isCompleted && <CompletedCard onBack={onBack} onHome={onHome} />}

      </ScrollView>

      {/* Sticky bottom action area for Learn mode */}
      {!isCompleted && (
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
                onPress={() => {
                  Keyboard.dismiss();
                  setAskMode(false);
                  setInput("");
                  // If the user has chat history, advance to next step
                  if ((chatHistory[session.current_step]?.length ?? 0) > 0) {
                    handleAdvance();
                  }
                }}
                style={readerStyles.askUnderstandBtn}
                accessibilityRole="button"
                accessibilityLabel="I understand, next step"
              >
                <Text style={readerStyles.askUnderstandText}>I understand</Text>
                <Ionicons name="arrow-forward" size={14} color={colors.primary} />
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
                onPress={session.status === "completed" ? finishAsking : handleAdvance}
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
  const colors = useColors();
  const compactStyles = useMemo(() => makeCompactStyles(colors), [colors]);
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

const makeReaderStyles = (colors: ColorPalette) => StyleSheet.create({
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
    paddingBottom: spacing.xl,
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
  askUnderstandBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primaryBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  askUnderstandText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 12,
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
const makeChatStyles = (colors: ColorPalette) => StyleSheet.create({
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

const makeCompactStyles = (colors: ColorPalette) => StyleSheet.create({
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
