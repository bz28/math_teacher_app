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
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { AnimatedPressable } from "./src/components/AnimatedPressable";
import { AuthScreen } from "./src/components/AuthScreen";
import { MathKeyboard } from "./src/components/MathKeyboard";
import { ModeSelectScreen, type Mode } from "./src/components/ModeSelectScreen";
import { OnboardingScreen } from "./src/components/OnboardingScreen";
import { SessionScreen } from "./src/components/SessionScreen";
import { HomeScreen } from "./src/components/HomeScreen";
import { clearAuth, loadStoredAuth, setOnSessionExpired } from "./src/services/api";
import { useSessionStore } from "./src/stores/session";
import { colors, spacing, radii, typography, shadows, gradients } from "./src/theme";

const ONBOARDING_KEY = "onboarding_completed";

type Screen = "auth" | "onboarding" | "home" | "mode-select" | "input" | "session";

export default function App() {
  const inputRef = useRef<TextInput>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("learn");
  const [practiceCount, setPracticeCount] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [fromOnboarding, setFromOnboarding] = useState(false);
  const {
    startSession,
    startPracticeBatch,
    phase: sessionPhase,
    error: sessionError,
  } = useSessionStore();

  const isLoading = sessionPhase === "loading";
  const displayError = error ?? sessionError;

  // On launch, check onboarding status and try to restore auth session
  useEffect(() => {
    setOnSessionExpired(() => {
      setScreen("auth");
      setFromOnboarding(false);
    });

    SecureStore.getItemAsync(ONBOARDING_KEY).then(async (done) => {
      if (!done) {
        setScreen("onboarding");
        return;
      }
      // Try to restore a previous session
      const restored = await loadStoredAuth();
      setScreen(restored ? "home" : "auth");
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

    // Navigate immediately — session screen shows skeleton while loading
    setScreen("session");

    if (mode === "practice") {
      await startPracticeBatch(text, practiceCount);
    } else {
      await startSession(text, mode);
    }

    // If generation failed, go back to input screen
    const { phase } = useSessionStore.getState();
    if (phase === "error") {
      setScreen("input");
      setError(useSessionStore.getState().error ?? "Something went wrong");
    }
  };

  const handleOnboardingComplete = async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, "true");
    setFromOnboarding(true);
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
        <AuthScreen onAuth={() => setScreen("home")} defaultToRegister={fromOnboarding} />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "home") {
    return (
      <SafeAreaProvider>
        <HomeScreen
          onSelect={() => setScreen("mode-select")}
          onLogout={async () => {
            await clearAuth();
            setFromOnboarding(false);
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

  const modeLabel = mode === "learn" ? "Learn" : mode === "practice" ? "Practice" : "Mock Exam";
  const modeIcon = mode === "learn" ? "book-outline" : mode === "practice" ? "pencil-outline" : "document-text-outline";

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
            <AnimatedPressable
              style={styles.backButton}
              onPress={() => setScreen("mode-select")}
            >
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
              <Text style={styles.backText}>Back</Text>
            </AnimatedPressable>

            <View style={styles.header}>
              <Text style={styles.headerTitle}>Enter a Problem</Text>
              <View style={styles.modeChip}>
                <Ionicons name={modeIcon as any} size={16} color={colors.primary} style={{ marginRight: spacing.xs }} />
                <Text style={styles.modeChipText}>{modeLabel}</Text>
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
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleGo}
              />
            </View>

            <MathKeyboard onInsert={handleInsert} />

            {mode === "practice" && (
              <View style={[styles.countPicker, shadows.sm]}>
                <Text style={styles.countLabel}>Similar problems to generate:</Text>
                <View style={styles.stepper}>
                  <AnimatedPressable
                    scaleDown={0.9}
                    onPress={() => setPracticeCount(Math.max(0, practiceCount - 1))}
                  >
                    <LinearGradient colors={gradients.primary} style={styles.stepperButton}>
                      <Ionicons name="remove" size={20} color={colors.white} />
                    </LinearGradient>
                  </AnimatedPressable>
                  <Text style={styles.countValue}>{practiceCount}</Text>
                  <AnimatedPressable
                    scaleDown={0.9}
                    onPress={() => setPracticeCount(Math.min(20, practiceCount + 1))}
                  >
                    <LinearGradient colors={gradients.primary} style={styles.stepperButton}>
                      <Ionicons name="add" size={20} color={colors.white} />
                    </LinearGradient>
                  </AnimatedPressable>
                </View>
                <Text style={styles.countHint}>
                  Total: {1 + practiceCount} problem{practiceCount > 0 ? "s" : ""}
                </Text>
              </View>
            )}

            <AnimatedPressable
              style={[(!input.trim() || isLoading) && styles.buttonDisabled]}
              onPress={handleGo}
              disabled={isLoading || !input.trim()}
            >
              <LinearGradient
                colors={gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.goButton}
              >
                {isLoading ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.goText}>Go</Text>
                )}
              </LinearGradient>
            </AnimatedPressable>

            {displayError && (
              <View style={styles.errorWrap}>
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={styles.error}>{displayError}</Text>
              </View>
            )}
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
    backgroundColor: colors.background,
  },
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xxl + 4,
    paddingBottom: spacing.xl,
  },
  backButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    marginBottom: spacing.sm,
  },
  backText: { color: colors.primary, ...typography.bodyBold },
  header: {
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  headerTitle: {
    ...typography.title,
    color: colors.text,
    marginBottom: 10,
  },
  modeChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primaryBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  modeChipText: { ...typography.label, color: colors.primary },
  inputWrapper: {
    width: "100%",
    marginBottom: spacing.xs,
  },
  inputLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  input: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 14,
    fontSize: 17,
    backgroundColor: colors.inputBg,
    color: colors.text,
  },
  goButton: {
    borderRadius: radii.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    width: "100%",
    alignItems: "center",
  },
  goText: { color: colors.white, ...typography.button, fontSize: 17 },
  errorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.md,
  },
  error: { color: colors.error, fontSize: 14 },
  countPicker: {
    width: "100%",
    alignItems: "center",
    marginTop: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  countLabel: { ...typography.label, color: colors.textSecondary, marginBottom: 10 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  countValue: { fontSize: 26, fontWeight: "bold", color: colors.text, minWidth: 30, textAlign: "center" },
  countHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  buttonDisabled: { opacity: 0.4 },
});
