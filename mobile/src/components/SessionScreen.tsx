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
import { MathKeyboard } from "./MathKeyboard";
import { PracticeSummary } from "./PracticeSummary";
import { LearnSummary } from "./LearnSummary";
import { useSessionStore } from "../stores/session";

interface SessionScreenProps {
  onBack: () => void;
}

export function SessionScreen({ onBack }: SessionScreenProps) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [input, setInput] = useState("");
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
    learnSimilarProblem,
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

  // Loading state
  if (phase === "loading") {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4A90D9" />
        <Text style={styles.loadingText}>
          {isBatchMode ? "Generating practice problems..." : "Generating problem..."}
        </Text>
      </SafeAreaView>
    );
  }

  // Practice batch mode
  if (isBatchMode) {
    const { problems, currentIndex, results } = practiceBatch;
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
            <TouchableOpacity onPress={handleBack}>
              <Text style={styles.backText}>{"\u2039"} Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>
              Practice {currentIndex + 1}/{problems.length}
            </Text>
          </View>
          <View style={styles.problemCard}>
            <Text style={styles.cardLabel}>Problem</Text>
            <Text style={styles.problemText}>{currentProblem.question}</Text>
          </View>
          <View style={styles.progressRow}>
            <View style={styles.progressContainer}>
              <View
                style={[
                  styles.progressBar,
                  { width: `${(currentIndex / problems.length) * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>
              {currentIndex}/{problems.length}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.promptText}>Enter your final answer</Text>

          {error && <Text style={styles.error}>{error}</Text>}

          <View>
            <Text style={styles.inputLabel}>Your answer</Text>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Enter your answer..."
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={handlePracticeSubmit}
            />
          </View>

          <MathKeyboard onInsert={handleInsert} />

          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.button, styles.submitButton, (phase === "thinking" || !input.trim()) && styles.buttonDisabled]}
              onPress={handlePracticeSubmit}
              disabled={phase === "thinking" || !input.trim()}
              activeOpacity={0.7}
            >
              {phase === "thinking" ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitText}>Answer</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.flagButton, practiceBatch.flags[currentIndex] && styles.flagButtonActive]}
              onPress={() => togglePracticeFlag(currentIndex)}
              activeOpacity={0.7}
            >
              <Text style={[styles.flagText, practiceBatch.flags[currentIndex] && styles.flagTextActive]}>
                {practiceBatch.flags[currentIndex] ? "Flagged" : "Flag"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
          <TouchableOpacity onPress={handleBack}>
            <Text style={styles.backText}>{"\u2039"} Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isLearnQueue && learnQueue
              ? `Learn ${learnQueue.currentIndex + 1}/${learnQueue.problems.length}`
              : isPractice ? "Practice" : "Learn"}
          </Text>
        </View>
        <View style={styles.problemCard}>
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
              <View key={i} style={styles.historyRow}>
                <Text style={styles.historyCheck}>{"\u2713"}</Text>
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
          <View style={styles.stepDescCard}>
            <Text style={styles.stepDescLabel}>Step {session.current_step + 1}</Text>
            <Text style={styles.stepDescText}>{currentStep.description}</Text>
            <Text style={styles.historyResult}>{currentStep.before} → {currentStep.after}</Text>
          </View>
        )}

        {/* Learn mode: final step — show what to do, ask for answer */}
        {isLearn && !isCompleted && isFinalStep && currentStep && (
          <View>
            <View style={styles.stepDescCard}>
              <Text style={styles.stepDescLabel}>Step {session.current_step + 1}</Text>
              <Text style={styles.stepDescText}>{currentStep.description}</Text>
              <Text style={styles.historyResult}>{currentStep.before}</Text>
            </View>
            <Text style={styles.promptText}>
              What is the result?
            </Text>
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
              lastResponse.is_correct ? styles.feedbackCorrect :
              lastResponse.action === "conversation" ? styles.feedbackConversation :
              styles.feedbackWrong,
            ]}
          >
            {lastResponse.action !== "conversation" && (
              <View style={styles.feedbackHeader}>
                <Text style={styles.feedbackIcon}>
                  {lastResponse.is_correct ? "\u2713" : "\u2717"}
                </Text>
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
          <TouchableOpacity
            style={styles.switchModeButton}
            onPress={switchToLearnMode}
            activeOpacity={0.7}
          >
            <Text style={styles.switchModeText}>Switch to Learn Mode</Text>
          </TouchableOpacity>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {/* Completed — learn queue mode */}
        {isCompleted && isLearnQueue && learnQueue && (
          <View style={styles.completedCard}>
            <Text style={styles.completedTitle}>Problem Solved!</Text>

            <TouchableOpacity
              style={styles.questionsButton}
              onPress={continueAsking}
              activeOpacity={0.7}
            >
              <Text style={styles.questionsText}>I still have questions</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.similarButton}
              onPress={learnSimilarProblem}
              activeOpacity={0.7}
            >
              <Text style={styles.similarText}>Learn Similar Problem</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.flagButtonWide, learnQueue.flags[learnQueue.currentIndex] && styles.flagButtonActive]}
              onPress={() => toggleLearnFlag(learnQueue.currentIndex)}
              activeOpacity={0.7}
            >
              <Text style={[styles.flagText, learnQueue.flags[learnQueue.currentIndex] && styles.flagTextActive]}>
                {learnQueue.flags[learnQueue.currentIndex] ? "Flagged" : "Flag for Practice"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.outlineButton}
              onPress={advanceLearnQueue}
              activeOpacity={0.7}
            >
              <Text style={styles.outlineButtonText}>
                {learnQueue.currentIndex < learnQueue.problems.length - 1
                  ? "Next Problem"
                  : "View Results"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Completed — non-queue mode */}
        {isCompleted && !isLearnQueue && (
          <View style={styles.completedCard}>
            <Text style={styles.completedTitle}>Problem Solved!</Text>
            {isPractice && (
              <View style={styles.solutionSteps}>
                <Text style={styles.solutionLabel}>Solution</Text>
                {session.steps.map((step, i) => (
                  <View key={i} style={styles.solutionRow}>
                    <Text style={styles.solutionStepNum}>Step {i + 1}</Text>
                    <Text style={styles.solutionDesc}>{step.description}</Text>
                    <Text style={styles.solutionResult}>{step.after}</Text>
                  </View>
                ))}
              </View>
            )}
            {isLearn && (
              <TouchableOpacity
                style={styles.similarButton}
                onPress={tryPracticeProblem}
                activeOpacity={0.7}
              >
                <Text style={styles.similarText}>Try a practice problem</Text>
              </TouchableOpacity>
            )}
            {isLearn && (
              <TouchableOpacity
                style={styles.questionsButton}
                onPress={continueAsking}
                activeOpacity={0.7}
              >
                <Text style={styles.questionsText}>I still have questions</Text>
              </TouchableOpacity>
            )}
            {isPractice && (
              <TouchableOpacity
                style={styles.similarButton}
                onPress={tryPracticeProblem}
                activeOpacity={0.7}
              >
                <Text style={styles.similarText}>Try a similar problem</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.outlineButton}
              onPress={handleBack}
              activeOpacity={0.7}
            >
              <Text style={styles.outlineButtonText}>New Problem</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Input area */}
        {!isCompleted && (
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
                    placeholderTextColor="#999"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={handleAsk}
                  />
                </View>

                <View style={styles.buttons}>
                  {input.trim() ? (
                    <TouchableOpacity
                      style={[styles.button, styles.submitButton, phase === "thinking" && styles.buttonDisabled]}
                      onPress={handleAsk}
                      disabled={phase === "thinking"}
                      activeOpacity={0.7}
                    >
                      {phase === "thinking" ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.submitText}>Ask</Text>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.button, styles.submitButton, phase === "thinking" && styles.buttonDisabled]}
                      onPress={advanceStep}
                      disabled={phase === "thinking"}
                      activeOpacity={0.7}
                    >
                      {phase === "thinking" ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.submitText}>I Understand</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}

            {/* Learn mode final step OR practice mode: answer input */}
            {(isPractice || (isLearn && isFinalStep)) && (
              <>
                <View>
                  <Text style={styles.inputLabel}>Your answer</Text>
                  <TextInput
                    ref={inputRef}
                    style={styles.input}
                    value={input}
                    onChangeText={setInput}
                    placeholder="Enter your answer..."
                    placeholderTextColor="#999"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={handleSubmit}
                  />
                </View>

                <MathKeyboard onInsert={handleInsert} />

                <View style={styles.buttons}>
                  <TouchableOpacity
                    style={[styles.button, styles.submitButton, (phase === "thinking" || !input.trim()) && styles.buttonDisabled]}
                    onPress={handleSubmit}
                    disabled={phase === "thinking" || !input.trim()}
                    activeOpacity={0.7}
                  >
                    {phase === "thinking" ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.submitText}>Answer</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}

          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: { marginTop: 16, fontSize: 16, color: "#888" },
  container: { flex: 1, backgroundColor: "#fff" },
  stickyHeader: { paddingHorizontal: 20, backgroundColor: "#fff" },
  content: { padding: 20, paddingTop: 8 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  backText: { color: "#4A90D9", fontSize: 16, fontWeight: "600", minHeight: 44, lineHeight: 44 },
  headerTitle: { fontSize: 15, fontWeight: "600", color: "#888" },
  problemCard: {
    backgroundColor: "#F7F8FA",
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E8EBF0",
  },
  completedCard: {
    backgroundColor: "#F7F8FA",
    borderRadius: 14,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E8EBF0",
  },
  cardLabel: { fontSize: 12, fontWeight: "600", color: "#999", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  problemText: { fontSize: 18, fontWeight: "600", color: "#1a1a1a" },
  promptText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 12,
    textAlign: "center",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  progressContainer: {
    flex: 1,
    height: 6,
    backgroundColor: "#E8EBF0",
    borderRadius: 3,
  },
  progressBar: { height: 6, backgroundColor: "#4A90D9", borderRadius: 3 },
  progressLabel: { fontSize: 12, fontWeight: "600", color: "#999" },
  historySection: { marginBottom: 12 },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#F0F7F0",
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#D4E8D4",
  },
  historyCheck: { fontSize: 16, color: "#4caf50", marginRight: 10, marginTop: 1 },
  historyContent: { flex: 1 },
  historyLabel: { fontSize: 11, fontWeight: "600", color: "#999", textTransform: "uppercase", letterSpacing: 0.5 },
  historyDesc: { fontSize: 14, color: "#666", marginTop: 2 },
  historyResult: { fontSize: 14, fontWeight: "600", color: "#333", marginTop: 2 },
  stepDescCard: {
    backgroundColor: "#EBF2FC",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: "#B8D4F0",
  },
  stepDescLabel: { fontSize: 12, fontWeight: "600", color: "#4A90D9", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  stepDescText: { fontSize: 16, fontWeight: "600", color: "#1a237e", marginBottom: 8 },
  stepDescHint: { fontSize: 13, color: "#42a5f5", fontStyle: "italic" },
  feedback: { borderRadius: 14, padding: 16, marginBottom: 12 },
  feedbackCorrect: { backgroundColor: "#F0F7F0", borderWidth: 1.5, borderColor: "#C8E6C9" },
  feedbackWrong: { backgroundColor: "#FFF5F5", borderWidth: 1.5, borderColor: "#FFCDD2" },
  feedbackConversation: { backgroundColor: "#EBF2FC", borderWidth: 1.5, borderColor: "#B8D4F0" },
  feedbackHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  feedbackIcon: { fontSize: 20, fontWeight: "bold", marginRight: 8 },
  feedbackTitle: { fontSize: 17, fontWeight: "bold" },
  feedbackTitleCorrect: { color: "#2e7d32" },
  feedbackTitleWrong: { color: "#c62828" },
  feedbackText: { fontSize: 15, lineHeight: 22, color: "#333" },
  error: { color: "#E53935", marginBottom: 12, textAlign: "center", fontSize: 14 },
  completedTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#4caf50",
    marginBottom: 16,
    textAlign: "center",
  },
  similarButton: {
    backgroundColor: "#4caf50",
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    alignItems: "center",
  },
  similarText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  outlineButton: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#4A90D9",
  },
  outlineButtonText: { color: "#4A90D9", fontWeight: "700", fontSize: 16 },
  inputLabel: { fontSize: 13, fontWeight: "600", color: "#888", marginBottom: 6 },
  input: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: "#E0E4EA",
    borderRadius: 12,
    padding: 14,
    fontSize: 17,
    minHeight: 48,
    backgroundColor: "#F9FAFB",
    color: "#1a1a1a",
  },
  buttons: { flexDirection: "row", gap: 12, marginTop: 10 },
  button: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  submitButton: { backgroundColor: "#4A90D9", flex: 1, alignItems: "center" },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  hintButton: { backgroundColor: "#FFF3E0" },
  hintText: { color: "#e65100", fontWeight: "600", fontSize: 16 },
  buttonDisabled: { opacity: 0.4 },
  questionsButton: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#e65100",
  },
  questionsText: { color: "#e65100", fontWeight: "700", fontSize: 16 },
  switchModeButton: {
    backgroundColor: "#1565c0",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    alignItems: "center",
  },
  switchModeText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  solutionSteps: { marginBottom: 12 },
  solutionLabel: { fontSize: 14, fontWeight: "600", color: "#888", marginBottom: 8 },
  solutionRow: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "#F0F7F0",
    borderRadius: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: "#D4E8D4",
  },
  solutionStepNum: { fontSize: 11, fontWeight: "600", color: "#999", textTransform: "uppercase", letterSpacing: 0.5 },
  solutionDesc: { fontSize: 14, color: "#666", marginTop: 2 },
  solutionResult: { fontSize: 14, fontWeight: "600", color: "#333", marginTop: 2 },
  flagButton: {
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#E0E4EA",
  },
  flagButtonActive: {
    backgroundColor: "#FFF3E0",
    borderColor: "#ff9800",
  },
  flagButtonWide: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#E0E4EA",
  },
  flagText: { color: "#999", fontWeight: "600", fontSize: 14 },
  flagTextActive: { color: "#e65100" },
});
