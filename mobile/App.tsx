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
import { MathKeyboard } from "./src/components/MathKeyboard";
import { SessionScreen } from "./src/components/SessionScreen";
import { HomeScreen } from "./src/components/HomeScreen";
import { setAuthToken } from "./src/services/api";
import { useSessionStore } from "./src/stores/session";

type Screen = "auth" | "home" | "input" | "session";

export default function App() {
  const inputRef = useRef<TextInput>(null);
  const [screen, setScreen] = useState<Screen>("auth");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"practice" | "learn">("practice");
  const [error, setError] = useState<string | null>(null);
  const {
    startSession,
    phase: sessionPhase,
    error: sessionError,
  } = useSessionStore();

  const isLoading = sessionPhase === "loading";
  const displayError = error ?? sessionError;

  const handleInsert = (value: string) => {
    setInput(input + value);
    inputRef.current?.focus();
  };

  const handleGo = async () => {
    const text = input.trim();
    if (!text) return;
    setError(null);
    await startSession(text, mode);
    // Store sets phase to "awaiting_input" on success, "error" on failure
    const { phase } = useSessionStore.getState();
    if (phase !== "error") {
      setScreen("session");
    }
  };

  if (screen === "auth") {
    return (
      <>
        <AuthScreen onAuth={() => setScreen("home")} />
        <StatusBar style="auto" />
      </>
    );
  }

  if (screen === "home") {
    return (
      <>
        <HomeScreen
          onSelect={() => setScreen("input")}
          onLogout={() => {
            setAuthToken(null);
            setScreen("auth");
          }}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (screen === "session") {
    return (
      <>
        <SessionScreen
          onBack={() => {
            setInput("");
            setScreen("input");
          }}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => setScreen("home")}
      >
        <Text style={styles.backText}>{"< Home"}</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Math Teacher</Text>

      <TextInput
        ref={inputRef}
        style={styles.input}
        value={input}
        onChangeText={(text) => {
          setInput(text);
          setError(null);
        }}
        placeholder="Enter a math problem (e.g. 2x + 6 = 12)"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={handleGo}
      />

      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.modeButton, mode === "practice" && styles.modeButtonActive]}
          onPress={() => setMode("practice")}
        >
          <Text style={[styles.modeText, mode === "practice" && styles.modeTextActive]}>
            Practice
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, mode === "learn" && styles.modeButtonActive]}
          onPress={() => setMode("learn")}
        >
          <Text style={[styles.modeText, mode === "learn" && styles.modeTextActive]}>
            Learn
          </Text>
        </TouchableOpacity>
      </View>

      <MathKeyboard onInsert={handleInsert} />

      <TouchableOpacity
        style={[styles.button, styles.goButton]}
        onPress={handleGo}
        disabled={isLoading || !input.trim()}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.goText}>Go</Text>
        )}
      </TouchableOpacity>

      {displayError && <Text style={styles.error}>{displayError}</Text>}

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
  modeToggle: {
    flexDirection: "row",
    width: "100%",
    backgroundColor: "#eee",
    borderRadius: 8,
    marginTop: 12,
    padding: 2,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 6,
  },
  modeButtonActive: { backgroundColor: "#4A90D9" },
  modeText: { fontSize: 15, fontWeight: "600", color: "#666" },
  modeTextActive: { color: "#fff" },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  goButton: {
    backgroundColor: "#4A90D9",
    marginTop: 12,
    width: "100%",
    alignItems: "center",
  },
  goText: { color: "#fff", fontWeight: "600", fontSize: 18 },
  backButton: { alignSelf: "flex-start", marginBottom: 8 },
  backText: { color: "#4A90D9", fontSize: 16, fontWeight: "600" },
  error: { color: "red", marginTop: 12, textAlign: "center" },
});
