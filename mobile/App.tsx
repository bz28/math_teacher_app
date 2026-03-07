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
              <Text style={styles.backText}>{"\u2039"} Back</Text>
            </TouchableOpacity>

            <View style={styles.header}>
              <Text style={styles.headerTitle}>Enter a Problem</Text>
              <View style={styles.modeChip}>
                <Text style={styles.modeChipText}>
                  {mode === "learn" ? "📖 Learn" : mode === "practice" ? "✏️ Practice" : "📝 Mock Exam"}
                </Text>
              </View>
            </View>

            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Math problem</Text>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={input}
                onChangeText={(text) => {
                  setInput(text);
                  setError(null);
                }}
                placeholder="e.g. 2x + 6 = 12"
                placeholderTextColor="#999"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleGo}
              />
            </View>

            <MathKeyboard onInsert={handleInsert} />

            {mode === "practice" && (
              <View style={styles.countPicker}>
                <Text style={styles.countLabel}>Similar problems to generate:</Text>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() => setPracticeCount(Math.max(0, practiceCount - 1))}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.stepperText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.countValue}>{practiceCount}</Text>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() => setPracticeCount(Math.min(20, practiceCount + 1))}
                    activeOpacity={0.7}
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
              style={[styles.goButton, (!input.trim() || isLoading) && styles.buttonDisabled]}
              onPress={handleGo}
              disabled={isLoading || !input.trim()}
              activeOpacity={0.7}
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
    paddingHorizontal: 28,
    paddingBottom: 20,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: 16,
    marginBottom: 8,
  },
  backText: { color: "#4A90D9", fontSize: 16, fontWeight: "600" },
  header: {
    alignItems: "center",
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginBottom: 10,
  },
  modeChip: {
    backgroundColor: "#EBF2FC",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  modeChipText: { fontSize: 14, fontWeight: "600", color: "#4A90D9" },
  inputWrapper: {
    width: "100%",
    marginBottom: 4,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: "#E0E4EA",
    borderRadius: 12,
    padding: 14,
    fontSize: 17,
    backgroundColor: "#F9FAFB",
    color: "#1a1a1a",
  },
  goButton: {
    backgroundColor: "#4A90D9",
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    width: "100%",
    alignItems: "center",
  },
  goText: { color: "#fff", fontWeight: "700", fontSize: 17 },
  error: { color: "#E53935", marginTop: 12, textAlign: "center", fontSize: 14 },
  countPicker: {
    width: "100%",
    alignItems: "center",
    marginTop: 16,
    backgroundColor: "#F7F8FA",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E8EBF0",
  },
  countLabel: { fontSize: 14, fontWeight: "600", color: "#666", marginBottom: 10 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#4A90D9",
    justifyContent: "center",
    alignItems: "center",
  },
  stepperText: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  countValue: { fontSize: 26, fontWeight: "bold", color: "#1a1a1a", minWidth: 30, textAlign: "center" },
  countHint: { fontSize: 12, color: "#999", marginTop: 6 },
  buttonDisabled: { opacity: 0.4 },
});
