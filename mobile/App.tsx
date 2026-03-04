import { useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AuthScreen } from "./src/components/AuthScreen";
import { KaTeXView } from "./src/components/KaTeXView";
import { MathKeyboard } from "./src/components/MathKeyboard";
import { SessionScreen } from "./src/components/SessionScreen";
import { useProblemStore } from "./src/stores/problem";
import { useSessionStore } from "./src/stores/session";

type Screen = "auth" | "input" | "session";

export default function App() {
  const inputRef = useRef<TextInput>(null);
  const [screen, setScreen] = useState<Screen>("auth");
  const { input, parsed, loading, error, setInput, submit, clear } =
    useProblemStore();
  const { startSession, phase: sessionPhase } = useSessionStore();

  const handleInsert = (value: string) => {
    setInput(input + value);
    inputRef.current?.focus();
  };

  const handleStartSession = async () => {
    if (!parsed) return;
    await startSession(parsed.expression);
    setScreen("session");
  };

  if (screen === "auth") {
    return (
      <>
        <AuthScreen onAuth={() => setScreen("input")} />
        <StatusBar style="auto" />
      </>
    );
  }

  if (screen === "session") {
    return (
      <>
        <SessionScreen onBack={() => setScreen("input")} />
        <StatusBar style="auto" />
      </>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Math Teacher</Text>

      <TextInput
        ref={inputRef}
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder="Enter a math problem (e.g. 2x + 6 = 12)"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      <MathKeyboard onInsert={handleInsert} />

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.submitButton]}
          onPress={submit}
          disabled={loading || !input.trim()}
        >
          <Text style={styles.submitText}>Parse</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.clearButton]}
          onPress={clear}
        >
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator size="large" style={styles.spinner} />}

      {error && <Text style={styles.error}>{error}</Text>}

      {parsed && (
        <View style={styles.result}>
          <Text style={styles.resultLabel}>Type: {parsed.problem_type}</Text>

          <Text style={styles.resultLabel}>Solutions</Text>
          {parsed.solutions_latex.map((sol, i) => (
            <KaTeXView key={i} latex={sol} displayMode />
          ))}

          <TouchableOpacity
            style={[styles.button, styles.startButton]}
            onPress={handleStartSession}
            disabled={sessionPhase === "loading"}
          >
            {sessionPhase === "loading" ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitText}>Start Tutoring Session</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 20 },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
  },
  buttons: { flexDirection: "row", gap: 12, marginTop: 8 },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  submitButton: { backgroundColor: "#4A90D9" },
  submitText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  clearButton: { backgroundColor: "#eee" },
  clearText: { color: "#666", fontWeight: "600", fontSize: 16 },
  startButton: {
    backgroundColor: "#4caf50",
    marginTop: 16,
    alignItems: "center",
    width: "100%",
  },
  spinner: { marginTop: 16 },
  error: { color: "red", marginTop: 12, textAlign: "center" },
  result: {
    marginTop: 20,
    width: "100%",
    alignItems: "center",
    gap: 8,
  },
  resultLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    marginTop: 8,
  },
});
