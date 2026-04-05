import { useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { BackButton } from "./BackButton";
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

/** Render text with **bold** markdown into React Native Text elements. */
function renderBold(text: string, style: TextStyle) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <Text key={i} style={[style, { fontWeight: "700" }]}>{part.slice(2, -2)}</Text>
      : part,
  );
}

export function SessionScreen({ onBack, onHome }: SessionScreenProps) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const confettiRef = useRef<ConfettiOverlayRef>(null);
  const [input, setInput] = useState("");
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

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

  // Confetti on learn completion
  useEffect(() => {
    if (phase === "completed") confettiRef.current?.fire();
  }, [phase]);

  // Loading state
  if (phase === "loading") {
    const isGrading = isBatchMode && practiceBatch.pendingChecks > 0
      && practiceBatch.results.length >= practiceBatch.problems.length;
    return (
      <SafeAreaView style={styles.loadingContainer}>
        {isGrading ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.gradingText}>Grading your answers...</Text>
          </>
        ) : isBatchMode ? <PracticeSkeleton /> : <SessionSkeleton />}
      </SafeAreaView>
    );
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
    setLastQuestion(text);
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
      <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <BackButton onPress={handleBack} />
          <View style={styles.headerBadge} accessibilityRole="text">
            <Text style={styles.headerBadgeText}>
              {isLearnQueue && learnQueue
                ? `${learnQueue.currentIndex + 1}/${learnQueue.problems.length}`
                : isPractice ? "Practice" : "Learn"}
            </Text>
          </View>
        </View>
        <View style={[styles.problemCard, shadows.sm]}>
          <Text style={styles.cardLabel}>Problem</Text>
          <Text style={styles.problemText}>{session.problem}</Text>
          {problemImages[session.problem] && (
            <Image
              source={{ uri: `data:image/jpeg;base64,${problemImages[session.problem]}` }}
              style={{ height: 120, marginTop: 8, borderRadius: 8 }}
              resizeMode="contain"
            />
          )}
        </View>
        {isLearn && (
          <View style={styles.progressRow}>
            <View style={styles.progressContainer}>
              <View
                style={[
                  styles.progressBar,
                  { width: `${(session.current_step / session.total_steps) * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>
              Step {session.current_step + 1}/{session.total_steps}
            </Text>
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
            <Text style={styles.stepDescText}>{renderBold(currentStep.description, styles.stepDescText)}</Text>
          </View>
        )}

        {/* Practice mode: prompt */}
        {isPractice && !isCompleted && (
          <Text style={styles.promptText}>Enter your final answer</Text>
        )}

        {/* User's question bubble (for chat conversations) */}
        {lastQuestion && lastResponse?.action === "conversation" && (
          <View style={compactStyles.questionBubble}>
            <Ionicons name="chatbubble" size={14} color={colors.primary} />
            <Text style={compactStyles.questionText}>{lastQuestion}</Text>
          </View>
        )}

        {/* Thinking indicator */}
        {phase === "thinking" && (
          <View style={[compactStyles.thinkingCard, shadows.sm]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={compactStyles.thinkingText}>Thinking...</Text>
          </View>
        )}

        {/* Feedback */}
        {lastResponse && phase !== "thinking" && (
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

        {/* Continue asking after completion */}
        {!isCompleted && session.status === "completed" && isLearn && (
          <>
            <View>
              <View style={styles.inputLabelRow}>
                <Text style={styles.inputLabel}>Ask a question about the problem</Text>
                {!isPro && chatsRemaining() < Infinity && (
                  <Text style={styles.chatCountText}>{chatsRemaining()} chats remaining</Text>
                )}
              </View>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="Ask a question..."
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleAsk}
                inputAccessoryViewID="math-session"
              />
            </View>

            <View style={styles.buttons}>
              {input.trim() ? (
                <GradientButton
                  onPress={handleAsk}
                  label="Ask"
                  loading={phase === "thinking"}
                  style={styles.submitButton}
                />
              ) : (
                <GradientButton
                  onPress={finishAsking}
                  label="I Understand Now"
                  style={styles.submitButton}
                />
              )}
            </View>
          </>
        )}

        {/* Input area */}
        {!isCompleted && session.status !== "completed" && (
          <>
            {/* Learn mode: chat input for questions */}
            {isLearn && (
              <>
                <View>
                  <View style={styles.inputLabelRow}>
                    <Text style={styles.inputLabel}>Have a question about this step?</Text>
                    {!isPro && chatsRemaining() < Infinity && (
                      <Text style={styles.chatCountText}>{chatsRemaining()} chats remaining</Text>
                    )}
                  </View>
                  <TextInput
                    ref={inputRef}
                    style={styles.input}
                    value={input}
                    onChangeText={setInput}
                    placeholder="Ask a question..."
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={handleAsk}
                    inputAccessoryViewID="math-session"
                  />
                </View>

                <View style={styles.buttons}>
                  {input.trim() ? (
                    <GradientButton
                      onPress={handleAsk}
                      label="Ask"
                      loading={phase === "thinking"}
                      style={styles.submitButton}
                    />
                  ) : (
                    <GradientButton
                      onPress={advanceStep}
                      label="I Understand"
                      loading={phase === "thinking"}
                      style={styles.submitButton}
                    />
                  )}
                </View>
              </>
            )}

            {/* Practice mode: answer input */}
            {isPractice && (
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
          </>
        )}
      </ScrollView>
      <MathKeyboard onInsert={handleInsert} accessoryID="math-session" />
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
        <Text style={compactStyles.historyText} numberOfLines={expanded ? undefined : 1}>
          {renderBold(description, compactStyles.historyText)}
        </Text>
      </View>
      <Ionicons
        name={expanded ? "chevron-up" : "chevron-down"}
        size={14}
        color={colors.textMuted}
      />
    </TouchableOpacity>
  );
}

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
