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
    togglePracticeFlag,
    retryFlaggedProblems,
    learnQueue,
    startLearnQueue,
    learnSimilarProblem,
    advanceLearnQueue,
    toggleLearnFlag,
    practiceFlaggedFromLearnQueue,
    requestShowStep,
    submitExplanation,
    switchToLearnMode,
    continueAsking,
    tryPracticeProblem,
    startSession,
    reset,
  } = useSessionStore();

  const isBatchMode = !!practiceBatch;
  const isLearnQueue = !!learnQueue;
  const isExplainBack = phase === "explain_back";
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
      const correct = results.filter((r) => r.isCorrect).length;
      const pct = correct / results.length;
      const encouragement =
        pct === 1 ? "Perfect score!" :
        pct >= 0.8 ? "Great job!" :
        pct >= 0.5 ? "Good effort, keep practicing!" :
        "Don't give up — review and try again!";

      return (
        <View style={styles.container}>
          <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
            <View style={styles.header}>
              <TouchableOpacity onPress={handleBack}>
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>
              <Text style={styles.title}>Practice Complete</Text>
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Results</Text>
              <Text style={styles.summaryScore}>
                {correct}/{results.length} correct
              </Text>
              <Text style={styles.summaryEncouragement}>{encouragement}</Text>
              <View style={styles.summaryBar}>
                <View
                  style={[
                    styles.summaryBarFill,
                    { width: `${(correct / results.length) * 100}%` },
                  ]}
                />
              </View>
            </View>

            {results.map((r, i) => (
              <View
                key={i}
                style={[
                  styles.resultRow,
                  r.isCorrect ? styles.resultCorrect : styles.resultWrong,
                ]}
              >
                <Text style={styles.resultIcon}>
                  {r.isCorrect ? "\u2713" : "\u2717"}
                </Text>
                <View style={styles.resultContent}>
                  <Text style={styles.resultProblem}>{r.problem}</Text>
                  <Text style={styles.resultAnswer}>
                    Your answer: {r.userAnswer}
                  </Text>
                  {!r.isCorrect && (
                    <Text style={styles.resultCorrectAnswer}>
                      Correct: {r.correctAnswer}
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  style={[styles.flagToggle, practiceBatch.flags[i] && styles.flagToggleActive]}
                  onPress={() => togglePracticeFlag(i)}
                >
                  <Text style={[styles.flagToggleText, practiceBatch.flags[i] && styles.flagToggleTextActive]}>
                    {practiceBatch.flags[i] ? "Flagged" : "Flag"}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}

            {practiceBatch.flags.some(Boolean) && (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={retryFlaggedProblems}
              >
                <Text style={styles.retryText}>
                  Retry {practiceBatch.flags.filter(Boolean).length} Flagged Problem{practiceBatch.flags.filter(Boolean).length > 1 ? "s" : ""}
                </Text>
              </TouchableOpacity>
            )}

            {practiceBatch.flags.some(Boolean) && (
              <TouchableOpacity
                style={styles.learnFlaggedButton}
                onPress={() => {
                  const flagged = practiceBatch.problems
                    .filter((_, i) => practiceBatch.flags[i])
                    .map((p) => p.question);
                  startLearnQueue(flagged);
                }}
              >
                <Text style={styles.learnFlaggedText}>
                  Learn {practiceBatch.flags.filter(Boolean).length} Flagged Problem{practiceBatch.flags.filter(Boolean).length > 1 ? "s" : ""}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.newProblemButton} onPress={handleBack}>
              <Text style={styles.newProblemText}>New Problem</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
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
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>
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
    const handleBack = () => { reset(); onBack(); };
    const flaggedCount = learnQueue.flags.filter(Boolean).length;

    return (
      <View style={styles.container}>
        <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={handleBack}>
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Learning Complete</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Problems Reviewed</Text>
            <Text style={styles.summaryScore}>{learnQueue.problems.length}</Text>
          </View>

          {learnQueue.problems.map((problem, i) => (
            <View key={i} style={[styles.resultRow, styles.resultCorrect]}>
              <Text style={styles.resultIcon}>{"\u2713"}</Text>
              <View style={styles.resultContent}>
                <Text style={styles.resultProblem}>{problem}</Text>
              </View>
              <TouchableOpacity
                style={[styles.flagToggle, learnQueue.flags[i] && styles.flagToggleActive]}
                onPress={() => toggleLearnFlag(i)}
              >
                <Text style={[styles.flagToggleText, learnQueue.flags[i] && styles.flagToggleTextActive]}>
                  {learnQueue.flags[i] ? "Flagged" : "Flag"}
                </Text>
              </TouchableOpacity>
            </View>
          ))}

          {flaggedCount > 0 && (
            <TouchableOpacity
              style={styles.learnFlaggedButton}
              onPress={practiceFlaggedFromLearnQueue}
            >
              <Text style={styles.learnFlaggedText}>
                Practice {flaggedCount} Flagged Problem{flaggedCount > 1 ? "s" : ""}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.newProblemButton} onPress={handleBack}>
            <Text style={styles.newProblemText}>New Problem</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // --- Learn mode ---

  if (!session) return null;

  const currentStep = session.steps[session.current_step];
  const isPractice = session.mode === "practice";
  const completedSteps = session.steps.slice(0, session.current_step);

  const handleSubmit = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    if (isExplainBack) {
      await submitExplanation(text);
    } else {
      await submitAnswer(text);
    }
  };

  const handleInsert = (value: string) => {
    setInput((prev) => prev + value);
    inputRef.current?.focus();
  };

  const handleBack = () => {
    reset();
    onBack();
  };

  const handleSimilarProblem = async (problem: string) => {
    const currentMode = session.mode;
    reset();
    await startSession(problem, currentMode);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>
            {isLearnQueue && learnQueue
              ? `Learn ${learnQueue.currentIndex + 1}/${learnQueue.problems.length}`
              : isPractice ? "Practice" : "Learn"}
          </Text>
        </View>
        <View style={styles.problemCard}>
          <Text style={styles.cardLabel}>Problem</Text>
          <Text style={styles.problemText}>{session.problem}</Text>
        </View>
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
            Step {session.current_step}/{session.total_steps}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Completed steps history (hidden during practice) */}
        {!isPractice && completedSteps.length > 0 && (
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

        {/* Current step guidance */}
        {!isCompleted && (
          <>
            {!isPractice && session.current_step > 0 && currentStep && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Current expression</Text>
                <Text style={styles.problemText}>{currentStep.before}</Text>
              </View>
            )}
            <Text style={styles.promptText}>
              {isPractice
                ? "Enter your final answer"
                : session.current_step === 0
                  ? "How would you solve this?"
                  : "Type an answer or ask a question..."}
            </Text>
          </>
        )}

        {/* Step description card (after show_step) */}
        {lastResponse?.action === "show_step" && lastResponse.step_description && (
          <View style={styles.stepDescCard}>
            <Text style={styles.stepDescLabel}>Next step</Text>
            <Text style={styles.stepDescText}>{lastResponse.step_description}</Text>
            <Text style={styles.stepDescHint}>Enter the math expression to continue</Text>
          </View>
        )}

        {/* Feedback */}
        {lastResponse && lastResponse.action !== "show_step" && (
          <View
            style={[
              styles.feedback,
              lastResponse.is_correct ? styles.feedbackCorrect : styles.feedbackWrong,
            ]}
          >
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
            <Text style={styles.feedbackText}>{lastResponse.feedback}</Text>
          </View>
        )}

        {/* Switch to Learn Mode (practice, wrong answer) */}
        {isPractice && lastResponse && !lastResponse.is_correct && !isCompleted && (
          <TouchableOpacity
            style={styles.switchModeButton}
            onPress={switchToLearnMode}
          >
            <Text style={styles.switchModeText}>Switch to Learn Mode</Text>
          </TouchableOpacity>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {/* Completed — learn queue mode */}
        {isCompleted && isLearnQueue && learnQueue && (
          <View style={styles.card}>
            <Text style={styles.completedTitle}>Problem Solved!</Text>

            <TouchableOpacity
              style={styles.questionsButton}
              onPress={continueAsking}
            >
              <Text style={styles.questionsText}>I still have questions</Text>
            </TouchableOpacity>

            {lastResponse?.similar_problem && (
              <TouchableOpacity
                style={styles.similarButton}
                onPress={learnSimilarProblem}
              >
                <Text style={styles.similarText}>Learn Similar Problem</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.flagButton, styles.flagButtonWide, learnQueue.flags[learnQueue.currentIndex] && styles.flagButtonActive]}
              onPress={() => toggleLearnFlag(learnQueue.currentIndex)}
            >
              <Text style={[styles.flagText, learnQueue.flags[learnQueue.currentIndex] && styles.flagTextActive]}>
                {learnQueue.flags[learnQueue.currentIndex] ? "Flagged" : "Flag for Practice"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.newProblemButton}
              onPress={advanceLearnQueue}
            >
              <Text style={styles.newProblemText}>
                {learnQueue.currentIndex < learnQueue.problems.length - 1
                  ? "Next Problem"
                  : "View Results"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Completed — non-queue mode */}
        {isCompleted && !isLearnQueue && (
          <View style={styles.card}>
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
            {!isPractice && lastResponse?.similar_problem && (
              <TouchableOpacity
                style={styles.similarButton}
                onPress={tryPracticeProblem}
              >
                <Text style={styles.similarText}>Try a practice problem</Text>
              </TouchableOpacity>
            )}
            {!isPractice && (
              <TouchableOpacity
                style={styles.questionsButton}
                onPress={continueAsking}
              >
                <Text style={styles.questionsText}>I still have questions</Text>
              </TouchableOpacity>
            )}
            {isPractice && lastResponse?.similar_problem && (
              <TouchableOpacity
                style={styles.similarButton}
                onPress={() => handleSimilarProblem(lastResponse.similar_problem!)}
              >
                <Text style={styles.similarText}>
                  Try: {lastResponse.similar_problem}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.newProblemButton} onPress={handleBack}>
              <Text style={styles.newProblemText}>New Problem</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Input area */}
        {!isCompleted && (
          <>
            {isExplainBack ? (
              <View style={styles.explainInputArea}>
                <Text style={styles.explainLabel}>
                  Explain this step in your own words
                </Text>
                <TextInput
                  ref={inputRef}
                  style={styles.explainInput}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Type your explanation..."
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={handleSubmit}
                  multiline
                />
              </View>
            ) : (
              <View>
                <Text style={styles.inputLabel}>Your answer</Text>
                <TextInput
                  ref={inputRef}
                  style={styles.input}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Enter your answer..."
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={handleSubmit}
                />
              </View>
            )}

            {!isExplainBack && <MathKeyboard onInsert={handleInsert} />}

            <View style={styles.buttons}>
              <TouchableOpacity
                style={[styles.button, styles.submitButton, (phase === "thinking" || !input.trim()) && styles.buttonDisabled]}
                onPress={handleSubmit}
                disabled={phase === "thinking" || !input.trim()}
              >
                {phase === "thinking" ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitText}>
                    {isExplainBack ? "Submit" : "Answer"}
                  </Text>
                )}
              </TouchableOpacity>

              {!isExplainBack && !isPractice && (
                <TouchableOpacity
                  style={[styles.button, styles.hintButton, phase === "thinking" && styles.buttonDisabled]}
                  onPress={requestShowStep}
                  disabled={phase === "thinking"}
                >
                  <Text style={styles.hintText}>Show next step</Text>
                </TouchableOpacity>
              )}
            </View>
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
  loadingText: { marginTop: 12, fontSize: 16, color: "#666" },
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
  title: { fontSize: 16, fontWeight: "600", color: "#666" },
  problemCard: {
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardLabel: { fontSize: 12, fontWeight: "600", color: "#999", marginBottom: 4 },
  problemText: { fontSize: 18, fontWeight: "600" },
  promptText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
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
    backgroundColor: "#eee",
    borderRadius: 3,
  },
  progressBar: { height: 6, backgroundColor: "#4A90D9", borderRadius: 3 },
  progressLabel: { fontSize: 12, fontWeight: "600", color: "#999" },
  historySection: { marginBottom: 12 },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#f6faf6",
    borderRadius: 8,
    marginBottom: 6,
  },
  historyCheck: { fontSize: 16, color: "#4caf50", marginRight: 10, marginTop: 1 },
  historyContent: { flex: 1 },
  historyLabel: { fontSize: 11, fontWeight: "600", color: "#999" },
  historyDesc: { fontSize: 14, color: "#666" },
  historyResult: { fontSize: 14, fontWeight: "600", color: "#333", marginTop: 2 },
  stepDescCard: {
    backgroundColor: "#e3f2fd",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#90caf9",
  },
  stepDescLabel: { fontSize: 12, fontWeight: "600", color: "#1565c0", marginBottom: 4 },
  stepDescText: { fontSize: 16, fontWeight: "600", color: "#1a237e", marginBottom: 8 },
  stepDescHint: { fontSize: 13, color: "#42a5f5", fontStyle: "italic" },
  feedback: { borderRadius: 12, padding: 16, marginBottom: 12 },
  feedbackCorrect: { backgroundColor: "#e8f5e9", borderWidth: 1, borderColor: "#a5d6a7" },
  feedbackWrong: { backgroundColor: "#fce4ec", borderWidth: 1, borderColor: "#ef9a9a" },
  feedbackHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  feedbackIcon: { fontSize: 20, fontWeight: "bold", marginRight: 8 },
  feedbackTitle: { fontSize: 17, fontWeight: "bold" },
  feedbackTitleCorrect: { color: "#2e7d32" },
  feedbackTitleWrong: { color: "#c62828" },
  feedbackText: { fontSize: 15, lineHeight: 22 },
  error: { color: "red", marginBottom: 12, textAlign: "center" },
  completedTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#4caf50",
    marginBottom: 12,
    textAlign: "center",
  },
  similarButton: {
    backgroundColor: "#4caf50",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    alignItems: "center",
  },
  similarText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  newProblemButton: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#4A90D9",
  },
  newProblemText: { color: "#4A90D9", fontWeight: "600", fontSize: 16 },
  inputLabel: { fontSize: 13, fontWeight: "600", color: "#999", marginBottom: 4 },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
    minHeight: 44,
  },
  explainInputArea: {
    backgroundColor: "#eef5ff",
    borderWidth: 1,
    borderColor: "#b3d4fc",
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
  },
  explainLabel: { fontSize: 14, fontWeight: "600", color: "#4A90D9", marginBottom: 8 },
  explainInput: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#b3d4fc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 60,
    backgroundColor: "#fff",
  },
  buttons: { flexDirection: "row", gap: 12, marginTop: 8 },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  submitButton: { backgroundColor: "#4A90D9", flex: 1, alignItems: "center" },
  submitText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  hintButton: { backgroundColor: "#fff3e0" },
  hintText: { color: "#e65100", fontWeight: "600", fontSize: 16 },
  buttonDisabled: { opacity: 0.5 },
  questionsButton: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#e65100",
  },
  questionsText: { color: "#e65100", fontWeight: "600", fontSize: 16 },
  switchModeButton: {
    backgroundColor: "#1565c0",
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    alignItems: "center",
  },
  switchModeText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  solutionSteps: { marginBottom: 12 },
  solutionLabel: { fontSize: 14, fontWeight: "600", color: "#666", marginBottom: 8 },
  solutionRow: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: "#f6faf6",
    borderRadius: 6,
    marginBottom: 4,
  },
  solutionStepNum: { fontSize: 11, fontWeight: "600", color: "#999" },
  solutionDesc: { fontSize: 14, color: "#666" },
  solutionResult: { fontSize: 14, fontWeight: "600", color: "#333", marginTop: 2 },
  // Practice summary
  summaryCard: {
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    alignItems: "center",
  },
  summaryTitle: { fontSize: 20, fontWeight: "bold", color: "#333", marginBottom: 8 },
  summaryScore: { fontSize: 28, fontWeight: "bold", color: "#4A90D9", marginBottom: 4 },
  summaryEncouragement: { fontSize: 16, color: "#666", marginBottom: 12, fontStyle: "italic" },
  summaryBar: {
    width: "100%",
    height: 8,
    backgroundColor: "#fce4ec",
    borderRadius: 4,
  },
  summaryBarFill: {
    height: 8,
    backgroundColor: "#4caf50",
    borderRadius: 4,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  resultCorrect: { backgroundColor: "#f6faf6" },
  resultWrong: { backgroundColor: "#fff5f5" },
  resultIcon: { fontSize: 18, fontWeight: "bold", marginRight: 10, marginTop: 1 },
  resultContent: { flex: 1 },
  resultProblem: { fontSize: 15, fontWeight: "600", color: "#333" },
  resultAnswer: { fontSize: 13, color: "#666", marginTop: 2 },
  resultCorrectAnswer: { fontSize: 13, color: "#d32f2f", marginTop: 2 },
  // Flag button (during answering)
  flagButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccc",
  },
  flagButtonActive: {
    backgroundColor: "#fff3e0",
    borderColor: "#ff9800",
  },
  flagButtonWide: {
    flex: 0,
    width: "100%",
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  flagText: { color: "#999", fontWeight: "600", fontSize: 14 },
  flagTextActive: { color: "#e65100" },
  // Flag toggle (on summary rows)
  flagToggle: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#ccc",
    alignSelf: "center",
    marginLeft: 8,
    minHeight: 36,
    justifyContent: "center",
  },
  flagToggleActive: {
    backgroundColor: "#fff3e0",
    borderColor: "#ff9800",
  },
  flagToggleText: { fontSize: 13, fontWeight: "600", color: "#999" },
  flagToggleTextActive: { color: "#e65100" },
  // Learn flagged button
  learnFlaggedButton: {
    backgroundColor: "#7c4dff",
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
    alignItems: "center",
  },
  learnFlaggedText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  retryButton: {
    backgroundColor: "#ff9800",
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
    alignItems: "center",
  },
  retryText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
