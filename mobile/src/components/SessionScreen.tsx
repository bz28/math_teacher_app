import { useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import {
  ActivityIndicator,
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
import { MathKeyboard } from "./MathKeyboard";
import { PracticeSummary } from "./PracticeSummary";
import { SessionSkeleton, PracticeSkeleton } from "./SkeletonLoader";
import { LearnSummary } from "./LearnSummary";
import { useSessionStore } from "../stores/session";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface SessionScreenProps {
  onBack: () => void;
}

export function SessionScreen({ onBack }: SessionScreenProps) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [input, setInput] = useState("");
  const [selectedChoice, setSelectedChoice] = useState<{ index: number; correct: boolean } | null>(null);
  const {
    session,
    phase,
    lastResponse,
    error,
    practiceBatch,
    submitAnswer,
    submitPracticeAnswer,
    advanceStep,
    askAboutStep,
    togglePracticeFlag,
    learnQueue,
    advanceLearnQueue,
    toggleLearnFlag,
    switchToLearnMode,
    continueAsking,
    tryPracticeProblem,
    startSession,
    reset,
  } = useSessionStore();

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

  // Animate step transitions in learn mode
  const prevStep = useRef(session?.current_step);
  useEffect(() => {
    if (session && session.current_step !== prevStep.current) {
      setSelectedChoice(null);
      prevStep.current = session.current_step;
    }
  }, [session?.current_step]);

  // Loading state — skeleton placeholders that mimic the real layout
  if (phase === "loading") {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        {isBatchMode ? <PracticeSkeleton /> : <SessionSkeleton />}
      </SafeAreaView>
    );
  }

  // Practice batch mode
  if (isBatchMode) {
    const { problems, currentIndex, results, totalCount } = practiceBatch;
    const currentProblem = problems[currentIndex];

    const handlePracticeSubmit = async () => {
      if (!input.trim()) return;
      const text = input.trim();
      setInput("");
      await submitPracticeAnswer(text);
    };

    const handleInsert = (value: string) => {
      setInput((prev) => prev + value);
      inputRef.current?.focus();
    };

    const handleBack = () => {
      reset();
      onBack();
    };

    // Summary screen
    if (isPracticeSummary) {
      return <PracticeSummary onBack={onBack} />;
    }

    // Answering screen
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <AnimatedPressable onPress={handleBack} style={styles.backWrap} accessibilityRole="button" accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
              <Text style={styles.backText}>Back</Text>
            </AnimatedPressable>
            <View style={styles.headerBadge} accessibilityRole="text" accessibilityLabel={`Problem ${currentIndex + 1} of ${totalCount}`}>
              <Text style={styles.headerBadgeText}>
                {currentIndex + 1}/{totalCount}
              </Text>
            </View>
          </View>
          <View style={[styles.problemCard, shadows.sm]}>
            <Text style={styles.cardLabel}>Problem</Text>
            <Text style={styles.problemText}>{currentProblem.question}</Text>
          </View>
          <View style={styles.progressRow}>
            <View style={styles.progressContainer}>
              <View
                style={[
                  styles.progressBar,
                  { width: `${(currentIndex / totalCount) * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>
              {currentIndex}/{totalCount}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.promptText}>Enter your final answer</Text>

          {error && (
            <View style={styles.errorWrap}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.error}>{error}</Text>
            </View>
          )}

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
              onSubmitEditing={handlePracticeSubmit}
              inputAccessoryViewID="math-session"
            />
          </View>

          <View style={styles.buttons}>
            <AnimatedPressable
              style={[(phase === "thinking" || !input.trim()) && styles.buttonDisabled]}
              onPress={handlePracticeSubmit}
              disabled={phase === "thinking" || !input.trim()}
            >
              <LinearGradient
                colors={gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.button, styles.submitButton]}
              >
                {phase === "thinking" ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.submitText}>Answer</Text>
                )}
              </LinearGradient>
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.button, styles.flagButton, practiceBatch.flags[currentIndex] && styles.flagButtonActive]}
              onPress={() => togglePracticeFlag(currentIndex)}
            >
              <Ionicons
                name={practiceBatch.flags[currentIndex] ? "flag" : "flag-outline"}
                size={16}
                color={practiceBatch.flags[currentIndex] ? colors.warningDark : colors.textMuted}
                style={{ marginRight: spacing.xs }}
              />
              <Text style={[styles.flagText, practiceBatch.flags[currentIndex] && styles.flagTextActive]}>
                {practiceBatch.flags[currentIndex] ? "Flagged" : "Flag"}
              </Text>
            </AnimatedPressable>
          </View>
        </ScrollView>
        <MathKeyboard onInsert={handleInsert} accessoryID="math-session" />
      </KeyboardAvoidingView>
    );
  }

  // --- Learn summary screen ---
  if (isLearnSummary && learnQueue) {
    return <LearnSummary onBack={onBack} />;
  }

  // --- Learn / Practice mode ---

  if (!session) return null;

  const currentStep = session.steps[session.current_step];
  const isPractice = session.mode === "practice";
  const isLearn = !isPractice;
  const completedSteps = session.steps.slice(0, session.current_step);
  const isFinalStep = session.current_step >= session.total_steps - 1;

  const handleSubmit = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    await submitAnswer(text);
  };

  const handleAsk = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    await askAboutStep(text);
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
          <AnimatedPressable onPress={handleBack} style={styles.backWrap} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </AnimatedPressable>
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
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Completed steps history (learn mode) */}
        {isLearn && completedSteps.length > 0 && (
          <View style={styles.historySection}>
            {completedSteps.map((step, i) => (
              <View key={i} style={[styles.historyRow, shadows.sm]}>
                <View style={styles.historyCheckWrap}>
                  <Ionicons name="checkmark" size={14} color={colors.success} />
                </View>
                <View style={styles.historyContent}>
                  <Text style={styles.historyLabel}>Step {i + 1}</Text>
                  <Text style={styles.historyDesc}>{step.description}</Text>
                  <Text style={styles.historyResult}>{step.after}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Learn mode: show current step (non-final) */}
        {isLearn && !isCompleted && !isFinalStep && currentStep && (
          <View style={[styles.stepDescCard, shadows.sm]}>
            <Text style={styles.stepDescLabel}>Step {session.current_step + 1}</Text>
            <Text style={styles.stepDescText}>{currentStep.description}</Text>
            <Text style={styles.historyResult}>{currentStep.before} → {currentStep.after}</Text>
          </View>
        )}

        {/* Learn mode: final step — multiple choice answer */}
        {isLearn && !isCompleted && isFinalStep && currentStep && (
          <View>
            <View style={[styles.stepDescCard, shadows.sm]}>
              <Text style={styles.stepDescLabel}>Step {session.current_step + 1}</Text>
              <Text style={styles.stepDescText}>{currentStep.description}</Text>
              <Text style={styles.historyResult}>{currentStep.before}</Text>
            </View>
            <Text style={styles.promptText}>
              What is the result?
            </Text>
            {currentStep.choices && (
              <View style={styles.choicesContainer}>
                {currentStep.choices.map((choice, i) => {
                  const isSelected = selectedChoice?.index === i;
                  const showCorrect = selectedChoice && choice.trim().toLowerCase() === currentStep.after.trim().toLowerCase();
                  const showWrong = isSelected && selectedChoice && !selectedChoice.correct;

                  return (
                    <AnimatedPressable
                      key={i}
                      style={[
                        styles.choiceButton,
                        shadows.sm,
                        !!selectedChoice && styles.buttonDisabled,
                        showCorrect && styles.choiceCorrect,
                        showWrong && styles.choiceWrong,
                      ]}
                      onPress={() => {
                        if (selectedChoice) return;
                        const isCorrect = choice.trim().toLowerCase() === currentStep.after.trim().toLowerCase();
                        setSelectedChoice({ index: i, correct: isCorrect });
                        Haptics.notificationAsync(
                          isCorrect ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
                        );
                        // Fire backend call in background
                        submitAnswer(choice);
                      }}
                      disabled={!!selectedChoice}
                      accessibilityRole="button"
                      accessibilityLabel={`Choice ${String.fromCharCode(65 + i)}: ${choice}`}
                    >
                      <View style={[
                        styles.choiceLetter,
                        showCorrect && styles.choiceLetterCorrect,
                        showWrong && styles.choiceLetterWrong,
                      ]}>
                        {showCorrect ? (
                          <Ionicons name="checkmark" size={14} color={colors.success} />
                        ) : showWrong ? (
                          <Ionicons name="close" size={14} color={colors.error} />
                        ) : (
                          <Text style={styles.choiceLetterText}>{String.fromCharCode(65 + i)}</Text>
                        )}
                      </View>
                      <Text style={[
                        styles.choiceText,
                        showCorrect && { color: colors.success },
                        showWrong && { color: colors.error },
                      ]}>{choice}</Text>
                    </AnimatedPressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Practice mode: prompt */}
        {isPractice && !isCompleted && (
          <Text style={styles.promptText}>Enter your final answer</Text>
        )}

        {/* Feedback (chat response or wrong answer) */}
        {lastResponse && (
          <View
            style={[
              styles.feedback,
              shadows.sm,
              lastResponse.is_correct ? styles.feedbackCorrect :
              lastResponse.action === "conversation" ? styles.feedbackConversation :
              styles.feedbackWrong,
            ]}
          >
            {lastResponse.action !== "conversation" && (
              <View style={styles.feedbackHeader}>
                <View style={[
                  styles.feedbackIconWrap,
                  { backgroundColor: lastResponse.is_correct ? colors.successLight : colors.errorLight },
                ]}>
                  <Ionicons
                    name={lastResponse.is_correct ? "checkmark" : "close"}
                    size={18}
                    color={lastResponse.is_correct ? colors.success : colors.error}
                  />
                </View>
                <Text
                  style={[
                    styles.feedbackTitle,
                    lastResponse.is_correct ? styles.feedbackTitleCorrect : styles.feedbackTitleWrong,
                  ]}
                >
                  {lastResponse.is_correct ? "Correct!" : "Not quite"}
                </Text>
              </View>
            )}
            <Text style={styles.feedbackText}>{lastResponse.feedback}</Text>
          </View>
        )}

        {/* Switch to Learn Mode (practice, wrong answer) */}
        {isPractice && lastResponse && !lastResponse.is_correct && !isCompleted && (
          <AnimatedPressable
            onPress={switchToLearnMode}
          >
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

        {/* Completed — learn queue mode */}
        {isCompleted && isLearnQueue && learnQueue && (
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
        )}

        {/* Completed — non-queue mode */}
        {isCompleted && !isLearnQueue && (
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
              <Text style={styles.outlineButtonText}>New Problem</Text>
            </AnimatedPressable>
          </View>
        )}

        {/* Continue asking after completion */}
        {!isCompleted && session.status === "completed" && isLearn && (
          <>
            <View>
              <Text style={styles.inputLabel}>Ask a question about the problem</Text>
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
              <AnimatedPressable
                style={[(phase === "thinking" || !input.trim()) && styles.buttonDisabled]}
                onPress={handleAsk}
                disabled={phase === "thinking" || !input.trim()}
              >
                <LinearGradient
                  colors={gradients.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.button, styles.submitButton]}
                >
                  {phase === "thinking" ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <Text style={styles.submitText}>Ask</Text>
                  )}
                </LinearGradient>
              </AnimatedPressable>
            </View>
          </>
        )}

        {/* Input area */}
        {!isCompleted && session.status !== "completed" && (
          <>
            {/* Learn mode non-final: chat input for questions */}
            {isLearn && !isFinalStep && (
              <>
                <View>
                  <Text style={styles.inputLabel}>Have a question about this step?</Text>
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
                    <AnimatedPressable
                      style={[phase === "thinking" && styles.buttonDisabled]}
                      onPress={handleAsk}
                      disabled={phase === "thinking"}
                    >
                      <LinearGradient
                        colors={gradients.primary}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.button, styles.submitButton]}
                      >
                        {phase === "thinking" ? (
                          <ActivityIndicator color={colors.white} size="small" />
                        ) : (
                          <Text style={styles.submitText}>Ask</Text>
                        )}
                      </LinearGradient>
                    </AnimatedPressable>
                  ) : (
                    <AnimatedPressable
                      style={[phase === "thinking" && styles.buttonDisabled]}
                      onPress={advanceStep}
                      disabled={phase === "thinking"}
                    >
                      <LinearGradient
                        colors={gradients.primary}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.button, styles.submitButton]}
                      >
                        {phase === "thinking" ? (
                          <ActivityIndicator color={colors.white} size="small" />
                        ) : (
                          <Text style={styles.submitText}>I Understand</Text>
                        )}
                      </LinearGradient>
                    </AnimatedPressable>
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
                  <AnimatedPressable
                    style={[(phase === "thinking" || !input.trim()) && styles.buttonDisabled]}
                    onPress={handleSubmit}
                    disabled={phase === "thinking" || !input.trim()}
                  >
                    <LinearGradient
                      colors={gradients.primary}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[styles.button, styles.submitButton]}
                    >
                      {phase === "thinking" ? (
                        <ActivityIndicator color={colors.white} size="small" />
                      ) : (
                        <Text style={styles.submitText}>Answer</Text>
                      )}
                    </LinearGradient>
                  </AnimatedPressable>
                </View>
              </>
            )}

          </>
        )}
      </ScrollView>
      <MathKeyboard onInsert={handleInsert} accessoryID="math-session" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  container: { flex: 1, backgroundColor: colors.background },
  stickyHeader: { paddingHorizontal: spacing.xl, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingTop: spacing.sm },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  backWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
  },
  backText: { color: colors.primary, ...typography.bodyBold },
  headerBadge: {
    backgroundColor: colors.primaryBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  headerBadgeText: { ...typography.label, color: colors.primary },
  problemCard: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  completedCard: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.xl,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  completedIconWrap: {
    alignItems: "center",
    marginBottom: spacing.md,
  },
  cardLabel: { ...typography.small, color: colors.textMuted, marginBottom: spacing.xs },
  problemText: { fontSize: 18, fontWeight: "600", color: colors.text },
  promptText: {
    ...typography.bodyBold,
    fontSize: 17,
    color: colors.text,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  choicesContainer: {
    gap: 10,
    marginBottom: spacing.lg,
  },
  choiceButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
  },
  choiceLetter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryBg,
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.md,
  },
  choiceLetterText: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.primary,
  },
  choiceText: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.primary,
  },
  choiceCorrect: {
    borderColor: colors.success,
    backgroundColor: colors.successLight,
  },
  choiceWrong: {
    borderColor: colors.error,
    backgroundColor: colors.errorLight,
  },
  choiceLetterCorrect: {
    backgroundColor: colors.successLight,
  },
  choiceLetterWrong: {
    backgroundColor: colors.errorLight,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: spacing.xs,
  },
  progressContainer: {
    flex: 1,
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
  },
  progressBar: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
  progressLabel: { ...typography.caption, color: colors.textMuted },
  historySection: { marginBottom: spacing.md },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.successLight,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  historyCheckWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.white,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
    marginTop: 1,
  },
  historyContent: { flex: 1 },
  historyLabel: { ...typography.small, color: colors.textMuted },
  historyDesc: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  historyResult: { fontSize: 14, fontWeight: "600", color: colors.text, marginTop: 2 },
  stepDescCard: {
    backgroundColor: colors.primaryBg,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.primaryLight,
  },
  stepDescLabel: { ...typography.small, color: colors.primary, marginBottom: spacing.xs },
  stepDescText: { ...typography.bodyBold, color: colors.primaryDark, marginBottom: spacing.sm },
  stepDescHint: { fontSize: 13, color: colors.primaryLight, fontStyle: "italic" },
  feedback: { borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md },
  feedbackCorrect: { backgroundColor: colors.successLight, borderWidth: 1.5, borderColor: colors.successBorder },
  feedbackWrong: { backgroundColor: colors.errorLight, borderWidth: 1.5, borderColor: colors.errorBorder },
  feedbackConversation: { backgroundColor: colors.primaryBg, borderWidth: 1.5, borderColor: colors.primaryLight },
  feedbackHeader: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  feedbackIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.sm,
  },
  feedbackTitle: { ...typography.bodyBold, fontSize: 17 },
  feedbackTitleCorrect: { color: colors.success },
  feedbackTitleWrong: { color: colors.error },
  feedbackText: { fontSize: 15, lineHeight: 22, color: colors.text },
  errorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  error: { color: colors.error, fontSize: 14 },
  completedTitle: {
    ...typography.heading,
    fontSize: 22,
    color: colors.success,
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  similarButton: {
    borderRadius: radii.md,
    padding: 14,
    marginTop: spacing.sm,
    alignItems: "center",
  },
  similarText: { color: colors.white, ...typography.button },
  outlineButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.md,
    padding: 14,
    marginTop: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  outlineButtonText: { color: colors.primary, ...typography.button },
  inputLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  input: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 14,
    fontSize: 17,
    minHeight: 48,
    backgroundColor: colors.inputBg,
    color: colors.text,
  },
  buttons: { flexDirection: "row", gap: spacing.md, marginTop: 10 },
  button: { paddingHorizontal: spacing.xxl, paddingVertical: 14, borderRadius: radii.md },
  submitButton: { flex: 1, alignItems: "center" },
  submitText: { color: colors.white, ...typography.button },
  hintButton: { backgroundColor: colors.warningBg },
  hintText: { color: colors.warningDark, fontWeight: "600", fontSize: 16 },
  buttonDisabled: { opacity: 0.4 },
  questionsButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.md,
    padding: 14,
    marginTop: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.warningDark,
  },
  questionsText: { color: colors.warningDark, ...typography.button },
  switchModeButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radii.md,
    padding: 14,
    marginBottom: spacing.md,
  },
  switchModeText: { color: colors.white, ...typography.button },
  solutionSteps: { marginBottom: spacing.md },
  solutionLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  solutionRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: 10,
    backgroundColor: colors.successLight,
    borderRadius: radii.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  solutionStepNum: { ...typography.small, color: colors.textMuted },
  solutionDesc: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  solutionResult: { fontSize: 14, fontWeight: "600", color: colors.text, marginTop: 2 },
  flagButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  flagButtonActive: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
  },
  flagButtonWide: {
    flexDirection: "row",
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: radii.md,
    marginTop: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  flagText: { color: colors.textMuted, fontWeight: "600", fontSize: 14 },
  flagTextActive: { color: colors.warningDark },
});
