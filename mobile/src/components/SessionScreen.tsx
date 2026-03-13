import { useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { BackButton } from "./BackButton";
import { CompletedCard } from "./CompletedCard";
import { GradientButton } from "./GradientButton";
import { MathKeyboard } from "./MathKeyboard";
import { MockTestScreen } from "./MockTestScreen";
import { MockTestSummary } from "./MockTestSummary";
import { PracticeBatchView } from "./PracticeBatchView";
import { PracticeSummary } from "./PracticeSummary";
import { SessionSkeleton, PracticeSkeleton } from "./SkeletonLoader";
import { LearnSummary } from "./LearnSummary";
import { useSessionStore } from "../stores/session";
import { colors, spacing, shadows, gradients } from "../theme";
import { sessionScreenStyles as styles } from "./sessionScreenStyles";

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
    mockTest,
    submitAnswer,
    advanceStep,
    askAboutStep,
    learnQueue,
    switchToLearnMode,
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

  // Reset choice selection on step transitions
  const prevStep = useRef(session?.current_step);
  useEffect(() => {
    if (session && session.current_step !== prevStep.current) {
      setSelectedChoice(null);
      prevStep.current = session.current_step;
    }
  }, [session?.current_step]);

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
    if (phase === "mock_test_summary") return <MockTestSummary onBack={onBack} />;
    return <MockTestScreen onBack={onBack} />;
  }

  // Practice batch mode
  if (isBatchMode) {
    if (isPracticeSummary) return <PracticeSummary onBack={onBack} />;
    return <PracticeBatchView onBack={onBack} />;
  }

  // Learn summary screen
  if (isLearnSummary && learnQueue) {
    return <LearnSummary onBack={onBack} />;
  }

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
              <View key={`step-${i}-${step.operation}`} style={[styles.historyRow, shadows.sm]}>
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
                      key={`choice-${i}-${choice}`}
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
                        submitAnswer(choice);
                        if (!isCorrect) {
                          setTimeout(() => setSelectedChoice(null), 1200);
                        }
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

        {/* Feedback */}
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
        {isCompleted && <CompletedCard onBack={onBack} />}

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
              <GradientButton
                onPress={handleAsk}
                label="Ask"
                loading={phase === "thinking"}
                disabled={!input.trim()}
                style={styles.submitButton}
              />
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
    </KeyboardAvoidingView>
  );
}
