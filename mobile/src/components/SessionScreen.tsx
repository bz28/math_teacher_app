import { useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MathKeyboard } from "./MathKeyboard";
import { useSessionStore } from "../stores/session";

interface SessionScreenProps {
  onBack: () => void;
}

export function SessionScreen({ onBack }: SessionScreenProps) {
  const inputRef = useRef<TextInput>(null);
  const [input, setInput] = useState("");
  const {
    session,
    phase,
    lastResponse,
    error,
    submitAnswer,
    requestHint,
    submitExplanation,
    reset,
  } = useSessionStore();

  if (!session) return null;

  const isExplainBack = phase === "explain_back";
  const isCompleted = phase === "completed";

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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>
          Step {Math.min(session.current_step + 1, session.total_steps)} of{" "}
          {session.total_steps}
        </Text>
      </View>

      {/* Problem */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Problem</Text>
        <Text style={styles.problemText}>{session.problem}</Text>
      </View>

      {/* Student prompt */}
      {!isCompleted && (
        <Text style={styles.promptText}>
          {session.current_step === 0
            ? "What would you do first?"
            : "What's your next step?"}
        </Text>
      )}

      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View
          style={[
            styles.progressBar,
            {
              width: `${(session.current_step / session.total_steps) * 100}%`,
            },
          ]}
        />
      </View>

      {/* Feedback */}
      {lastResponse && (
        <View
          style={[
            styles.feedback,
            lastResponse.is_correct ? styles.feedbackCorrect : styles.feedbackWrong,
          ]}
        >
          <Text style={styles.feedbackText}>{lastResponse.feedback}</Text>
        </View>
      )}

      {/* Error */}
      {error && <Text style={styles.error}>{error}</Text>}

      {/* Completed */}
      {isCompleted && (
        <View style={styles.card}>
          <Text style={styles.completedTitle}>Problem Solved!</Text>
          {lastResponse?.similar_problem && (
            <>
              <Text style={styles.cardLabel}>Try a similar problem:</Text>
              <Text style={styles.problemText}>{lastResponse.similar_problem}</Text>
            </>
          )}
          <TouchableOpacity style={styles.newProblemButton} onPress={handleBack}>
            <Text style={styles.newProblemText}>New Problem</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Input area */}
      {!isCompleted && (
        <>
          {isExplainBack && (
            <Text style={styles.explainPrompt}>
              Explain this step in your own words:
            </Text>
          )}

          <TextInput
            ref={inputRef}
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={
              isExplainBack
                ? "Type your explanation..."
                : "Enter your answer..."
            }
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
            multiline={isExplainBack}
          />

          {!isExplainBack && <MathKeyboard onInsert={handleInsert} />}

          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.button, styles.submitButton]}
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

            {!isExplainBack && (
              <TouchableOpacity
                style={[styles.button, styles.hintButton]}
                onPress={requestHint}
                disabled={phase === "thinking"}
              >
                <Text style={styles.hintText}>Hint</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingTop: 60 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  backText: { color: "#4A90D9", fontSize: 16, fontWeight: "600" },
  title: { fontSize: 16, fontWeight: "600", color: "#666" },
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
  progressContainer: {
    height: 4,
    backgroundColor: "#eee",
    borderRadius: 2,
    marginBottom: 16,
  },
  progressBar: { height: 4, backgroundColor: "#4A90D9", borderRadius: 2 },
  feedback: { borderRadius: 8, padding: 12, marginBottom: 12 },
  feedbackCorrect: { backgroundColor: "#e8f5e9" },
  feedbackWrong: { backgroundColor: "#fce4ec" },
  feedbackText: { fontSize: 14 },
  error: { color: "red", marginBottom: 12, textAlign: "center" },
  completedTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#4caf50",
    marginBottom: 12,
    textAlign: "center",
  },
  newProblemButton: {
    backgroundColor: "#4A90D9",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    alignItems: "center",
  },
  newProblemText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  explainPrompt: {
    fontSize: 16,
    fontWeight: "600",
    color: "#4A90D9",
    marginBottom: 8,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
    minHeight: 44,
  },
  buttons: { flexDirection: "row", gap: 12, marginTop: 8 },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  submitButton: { backgroundColor: "#4A90D9", flex: 1, alignItems: "center" },
  submitText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  hintButton: { backgroundColor: "#fff3e0" },
  hintText: { color: "#e65100", fontWeight: "600", fontSize: 16 },
});
