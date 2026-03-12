import { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Alert,
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
import * as Haptics from "expo-haptics";
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
  const [problemQueue, setProblemQueue] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fromOnboarding, setFromOnboarding] = useState(false);
  const {
    startSession,
    startPracticeBatch,
    startPracticeQueue,
    startLearnQueue,
    phase: sessionPhase,
    error: sessionError,
  } = useSessionStore();

  const isLoading = sessionPhase === "loading";
  const displayError = error ?? sessionError;

  const navigateTo = (next: Screen) => {
    setScreen(next);
  };

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

  const MAX_PROBLEMS = 10;

  const handleAddToQueue = () => {
    const text = input.trim();
    if (!text || problemQueue.length >= MAX_PROBLEMS) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setProblemQueue([...problemQueue, text]);
    setInput("");
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    inputRef.current?.focus();
  };

  const handleRemoveFromQueue = (index: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setProblemQueue(problemQueue.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleEditFromQueue = (index: number) => {
    setInput(problemQueue[index]);
    handleRemoveFromQueue(index);
    inputRef.current?.focus();
  };

  const handleGo = async () => {
    // Collect all problems: queue + any text currently in the input
    const allProblems = [...problemQueue];
    const text = input.trim();
    if (text) allProblems.push(text);
    if (allProblems.length === 0) return;
    setError(null);

    // Navigate immediately — session screen shows skeleton while loading
    setScreen("session");

    if (allProblems.length === 1) {
      // Single problem — existing behavior
      if (mode === "practice") {
        await startPracticeBatch(allProblems[0], practiceCount);
      } else {
        await startSession(allProblems[0], mode);
      }
    } else {
      // Multi-problem queue
      if (mode === "practice") {
        await startPracticeQueue(allProblems);
      } else {
        await startLearnQueue(allProblems);
      }
    }

    // If generation failed, go back to input screen
    const { phase } = useSessionStore.getState();
    if (phase === "error") {
      navigateTo("input");
      setError(useSessionStore.getState().error ?? "Something went wrong");
    } else {
      setProblemQueue([]);
      navigateTo("session");
    }
  };

  const handleOnboardingComplete = async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, "true");
    setFromOnboarding(true);
    navigateTo("auth");
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
        <AuthScreen onAuth={() => navigateTo("home")} defaultToRegister={fromOnboarding} />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "home") {
    return (
      <SafeAreaProvider>
        <HomeScreen
          onSelect={() => navigateTo("mode-select")}
          onLogout={() => {
            Alert.alert("Log Out", "Are you sure you want to log out?", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Log Out",
                style: "destructive",
                onPress: async () => {
                  await clearAuth();
                  setFromOnboarding(false);
                  navigateTo("auth");
                },
              },
            ]);
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
            navigateTo("input");
          }}
          onBack={() => navigateTo("home")}
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
            setProblemQueue([]);
            navigateTo("input");
          }}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  const modeLabel = mode === "learn" ? "Learn" : mode === "practice" ? "Practice" : "Mock Exam";
  const modeIcon = mode === "learn" ? "book-outline" : mode === "practice" ? "pencil-outline" : "document-text-outline";
  const totalProblems = problemQueue.length + (input.trim() ? 1 : 0);
  const hasNoProblems = totalProblems === 0;
  const goButtonLabel = problemQueue.length > 0
    ? `Start ${modeLabel} (${totalProblems})`
    : "Go";

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
              onPress={() => {
                setProblemQueue([]);
                navigateTo("mode-select");
              }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
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
              <View style={styles.inputRow}>
                <TextInput
                  ref={inputRef}
                  style={styles.inputField}
                  value={input}
                  onChangeText={(text) => {
                    setInput(text);
                    setError(null);
                  }}
                  placeholder="e.g. 2x + 6 = 12"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType={problemQueue.length > 0 ? "next" : "go"}
                  onSubmitEditing={problemQueue.length > 0 ? handleAddToQueue : handleGo}
                  inputAccessoryViewID="math-input"
                />
                <AnimatedPressable
                  style={[styles.addButton, (!input.trim() || problemQueue.length >= MAX_PROBLEMS) && styles.addButtonDisabled]}
                  onPress={handleAddToQueue}
                  disabled={!input.trim() || problemQueue.length >= MAX_PROBLEMS}
                  scaleDown={0.85}
                >
                  <Ionicons
                    name="add-circle"
                    size={32}
                    color={input.trim() && problemQueue.length < MAX_PROBLEMS ? colors.primary : colors.textMuted}
                  />
                </AnimatedPressable>
              </View>
            </View>

            {problemQueue.length > 0 && (
              <View style={[styles.queueContainer, shadows.sm]}>
                {problemQueue.map((problem, i) => (
                  <View key={`${i}-${problem}`} style={styles.queueRow}>
                    <AnimatedPressable
                      style={styles.queueProblem}
                      onPress={() => handleEditFromQueue(i)}
                    >
                      <Text style={styles.queueIndex}>{i + 1}.</Text>
                      <Text style={styles.queueText} numberOfLines={1}>{problem}</Text>
                    </AnimatedPressable>
                    <AnimatedPressable
                      onPress={() => handleRemoveFromQueue(i)}
                      scaleDown={0.85}
                      style={styles.queueRemove}
                    >
                      <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                    </AnimatedPressable>
                  </View>
                ))}
                {problemQueue.length >= MAX_PROBLEMS && (
                  <Text style={styles.queueMaxHint}>Maximum {MAX_PROBLEMS} problems</Text>
                )}
              </View>
            )}

            <MathKeyboard onInsert={handleInsert} accessoryID="math-input" />

            {mode === "practice" && problemQueue.length === 0 && (
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
              style={[hasNoProblems && styles.buttonDisabled]}
              onPress={handleGo}
              disabled={isLoading || hasNoProblems}
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
                  <Text style={styles.goText}>{goButtonLabel}</Text>
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
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    width: "100%",
  },
  inputField: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 14,
    fontSize: 17,
    backgroundColor: colors.inputBg,
    color: colors.text,
  },
  addButton: {
    padding: spacing.xs,
  },
  addButtonDisabled: {
    opacity: 0.4,
  },
  queueContainer: {
    width: "100%",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  queueRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  queueProblem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  queueIndex: {
    ...typography.label,
    color: colors.textMuted,
    minWidth: 20,
  },
  queueText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  queueRemove: {
    padding: spacing.xs,
  },
  queueMaxHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: "center",
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
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
