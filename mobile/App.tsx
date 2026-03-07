import { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
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
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import { AuthScreen } from "./src/components/AuthScreen";
import { MathKeyboard } from "./src/components/MathKeyboard";
import { ModeSelectScreen, type Mode } from "./src/components/ModeSelectScreen";
import { OnboardingScreen } from "./src/components/OnboardingScreen";
import { SessionScreen } from "./src/components/SessionScreen";
import { HomeScreen } from "./src/components/HomeScreen";
import { setAuthToken } from "./src/services/api";
import { useSessionStore } from "./src/stores/session";

const ONBOARDING_KEY = "onboarding_completed";

type Screen = "auth" | "onboarding" | "home" | "mode-select" | "input" | "session";

export default function App() {
  const inputRef = useRef<TextInput>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("learn");
  const [practiceCount, setPracticeCount] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const {
    startSession,
    startPracticeBatch,
    phase: sessionPhase,
    error: sessionError,
  } = useSessionStore();

  const isLoading = sessionPhase === "loading";
  const displayError = error ?? sessionError;

  // On launch, check if onboarding was already completed
  useEffect(() => {
    SecureStore.getItemAsync(ONBOARDING_KEY).then((done) => {
      setScreen(done ? "auth" : "onboarding");
    });
  }, []);

  const handleInsert = (value: string) => {
    setInput(input + value);
    inputRef.current?.focus();
  };

  const handleGo = async () => {
    const text = input.trim();
    if (!text) return;
    setError(null);

    if (mode === "practice") {
      await startPracticeBatch(text, practiceCount);
    } else {
      await startSession(text, mode);
    }

    const { phase } = useSessionStore.getState();
    if (phase !== "error") {
      setScreen("session");
    }
  };

  const handleOnboardingComplete = async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, "true");
    setScreen("auth");
  };

  // Show nothing while checking onboarding status
  if (screen === null) {
    return null;
  }

  if (screen === "onboarding") {
    return (
      <SafeAreaProvider>
        <OnboardingScreen onComplete={handleOnboardingComplete} />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "auth") {
    return (
      <SafeAreaProvider>
        <AuthScreen onAuth={() => setScreen("home")} />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "home") {
    return (
      <SafeAreaProvider>
        <HomeScreen
          onSelect={() => setScreen("mode-select")}
          onLogout={() => {
            setAuthToken(null);
            setScreen("auth");
          }}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "mode-select") {
    return (
      <SafeAreaProvider>
        <ModeSelectScreen
          onSelect={(selectedMode) => {
            setMode(selectedMode);
            setScreen("input");
          }}
          onBack={() => setScreen("home")}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "session") {
    return (
      <SafeAreaProvider>
        <SessionScreen
          onBack={() => {
            setInput("");
            setScreen("input");
          }}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setScreen("mode-select")}
            >
              <Text style={styles.backText}>{"\u2039 Back"}</Text>
            </TouchableOpacity>
            <View style={styles.modeChip}>
              <Text style={styles.modeChipText}>
                {mode === "learn" ? "📖 Learn" : mode === "practice" ? "✏️ Practice" : "📝 Mock Exam"}
              </Text>
            </View>

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

            <MathKeyboard onInsert={handleInsert} />

            {mode === "practice" && (
              <View style={styles.countPicker}>
                <Text style={styles.countLabel}>Similar problems to generate:</Text>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() => setPracticeCount(Math.max(0, practiceCount - 1))}
                  >
                    <Text style={styles.stepperText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.countValue}>{practiceCount}</Text>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() => setPracticeCount(Math.min(20, practiceCount + 1))}
                  >
                    <Text style={styles.stepperText}>+</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.countHint}>
                  Total: {1 + practiceCount} problem{practiceCount > 0 ? "s" : ""}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, styles.goButton, (!input.trim() || isLoading) && styles.buttonDisabled]}
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
          </ScrollView>
        </KeyboardAvoidingView>
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  flex: { flex: 1 },
  scrollContent: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 20,
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
  // Practice count picker
  countPicker: {
    width: "100%",
    alignItems: "center",
    marginTop: 16,
  },
  countLabel: { fontSize: 14, fontWeight: "600", color: "#666", marginBottom: 8 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  stepperButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#4A90D9",
    justifyContent: "center",
    alignItems: "center",
  },
  stepperText: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  countValue: { fontSize: 24, fontWeight: "bold", color: "#333", minWidth: 30, textAlign: "center" },
  countHint: { fontSize: 12, color: "#999", marginTop: 4 },
  buttonDisabled: { opacity: 0.5 },
  modeChip: {
    backgroundColor: "#F0F4FF",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#4A90D9",
  },
  modeChipText: { fontSize: 15, fontWeight: "600", color: "#4A90D9" },
});
